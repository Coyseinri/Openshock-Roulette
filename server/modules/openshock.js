// Extracted from server/app.js. Loaded by server/app.js in order.

function safety() {
  return readConfig().safety || {};
}

function sendJson(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function requestOpenShock(method, apiPath, body, optionsOverride = {}) {
  return new Promise((resolve, reject) => {
    if (!TOKEN) {
      const err = new Error("Missing OPENSHOCK_TOKEN / OPENSHOCK_API_TOKEN environment variable");
      debugState.counters.openShockErrors += 1;
      logOpenShockCall({
        time: new Date().toISOString(),
        method,
        path: apiPath,
        action: optionsOverride.action || inferOpenShockAction(method, apiPath, body),
        status: "error",
        error: err.message,
        responseTimeMs: 0
      });
      reject(err);
      return;
    }

    const postData = body ? JSON.stringify(body) : "";
    const timeoutMs = clampInt(
      optionsOverride.timeoutMs ?? readConfig().server?.openShockTimeoutMs ?? process.env.OPENSHOCK_TIMEOUT_MS ?? 2500,
      500,
      15000
    );
    const action = optionsOverride.action || inferOpenShockAction(method, apiPath, body);
    const options = {
      hostname: API_HOST,
      port: 443,
      path: apiPath,
      method,
      headers: {
        "User-Agent": USER_AGENT,
        "Open-Shock-Token": TOKEN,
        "Accept": "application/json"
      }
    };

    if (body) {
      options.headers["Content-Type"] = "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const startedAt = Date.now();
    let timedOut = false;
    debugState.counters.openShockTotal += 1;
    const req = https.request(options, res => {
      let responseData = "";
      res.on("data", chunk => responseData += chunk);
      res.on("end", () => {
        const durationMs = Date.now() - startedAt;
        let parsed = responseData;
        try { parsed = responseData ? JSON.parse(responseData) : null; } catch {}
        debugState.openShockDurations.push(durationMs);
        while (debugState.openShockDurations.length > 100) debugState.openShockDurations.shift();
        if (res.statusCode >= 400) debugState.counters.openShockErrors += 1;
        logOpenShockCall({
          time: new Date().toISOString(),
          method,
          path: apiPath,
          action,
          statusCode: res.statusCode,
          status: res.statusCode >= 200 && res.statusCode < 300 ? "success" : "http_error",
          responseTimeMs: durationMs,
          request: summarizeOpenShockBody(body),
          responseSummary: summarizeOpenShockResponse(parsed)
        });
        resolve({ statusCode: res.statusCode, body: parsed, durationMs });
      });
    });

    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy(new Error(`OpenShock request timed out after ${timeoutMs}ms: ${method} ${apiPath}`));
    });
    req.on("error", err => {
      const durationMs = Date.now() - startedAt;
      debugState.counters.openShockErrors += 1;
      if (timedOut) debugState.counters.openShockTimeouts += 1;
      logOpenShockCall({
        time: new Date().toISOString(),
        method,
        path: apiPath,
        action,
        status: timedOut ? "timeout" : "error",
        error: err.message,
        responseTimeMs: durationMs,
        request: summarizeOpenShockBody(body)
      });
      reject(err);
    });
    if (body) req.write(postData);
    req.end();
  });
}

function inferOpenShockAction(method, apiPath, body) {
  if (method === "GET" && String(apiPath).includes("shockers")) return "loadShockers";
  const shocks = Array.isArray(body?.shocks) ? body.shocks : [];
  if (shocks.some(s => s.type === "Stop")) return "stop";
  if (shocks.some(s => s.type === "Shock")) return "shock";
  if (shocks.some(s => s.type === "Vibrate")) return "vibrate";
  return `${method} ${apiPath}`;
}

function summarizeOpenShockBody(body) {
  if (!body || typeof body !== "object") return null;
  const shocks = Array.isArray(body.shocks) ? body.shocks : null;
  if (!shocks) return { keys: Object.keys(body) };
  return {
    shockCount: shocks.length,
    shocks: shocks.map(s => ({ id: s.id, type: s.type, intensity: s.intensity, duration: s.duration, exclusive: s.exclusive }))
  };
}

function summarizeOpenShockResponse(body) {
  if (!body || typeof body !== "object") return body === null ? null : typeof body;
  if (Array.isArray(body)) return { type: "array", length: body.length };
  return { type: "object", keys: Object.keys(body).slice(0, 12) };
}

function normalizeShockers(data) {
  const found = [];

  function looksLikeShockerObject(x) {
    if (!x || typeof x !== "object") return false;

    const id = x.id || x.shockerId || x.uuid;
    const name = x.name || x.shockerName || x.label;

    if (typeof id !== "string" || id.length < 20) return false;
    if (typeof name !== "string" || !name.trim()) return false;

    // Avoid known parent/container objects.
    const typeText = String(x.type || x.deviceType || x.objectType || x.kind || "").toLowerCase();
    if (typeText.includes("hub") || typeText.includes("device")) return false;

    // Positive hints seen in OpenShock-ish data structures.
    if ("shockerId" in x || "rfId" in x || "model" in x || "limits" in x || "isPaused" in x) return true;

    // Fallback: if it came from a shocker-named collection, it is probably valid.
    return true;
  }

  function addCandidate(x) {
    if (!looksLikeShockerObject(x)) return;
    const id = x.id || x.shockerId || x.uuid;
    const name = x.name || x.shockerName || x.label;
    found.push({ id, name });
  }

  function walkShockerCollections(x, keyHint = "") {
    if (!x || typeof x !== "object") return;

    if (Array.isArray(x)) {
      if (keyHint.toLowerCase().includes("shocker")) {
        x.forEach(addCandidate);
      }
      x.forEach(item => walkShockerCollections(item, keyHint));
      return;
    }

    for (const [key, value] of Object.entries(x)) {
      const lower = key.toLowerCase();

      // Only collect direct objects/arrays from shocker-like fields.
      if (lower.includes("shocker")) {
        if (Array.isArray(value)) value.forEach(addCandidate);
        else addCandidate(value);
      }

      walkShockerCollections(value, key);
    }
  }

  walkShockerCollections(data);

  // Last-resort support for endpoints that return an array of shockers directly.
  if (Array.isArray(data)) data.forEach(addCandidate);

  const unique = new Map();
  found.forEach(s => unique.set(s.id, s));

  const cfg = readConfig();
  const excludeIds = new Set((cfg.shockers?.excludeIds || []).map(String));
  const excludeNames = new Set((cfg.shockers?.excludeNames || []).map(String).map(s => s.toLowerCase()));

  return Array.from(unique.values()).filter(s =>
    !excludeIds.has(s.id) &&
    !excludeNames.has(String(s.name).toLowerCase())
  );
}

var SHOCKER_CACHE_DEFAULT_MS = 30000;
var shockerCache = {
  value: null,
  expiresAt: 0,
  inFlight: null,
  lastError: null
};

function shockerCacheTtlMs() {
  return clampInt(readConfig().shockers?.cacheTtlMs ?? process.env.SHOCKER_CACHE_MS ?? SHOCKER_CACHE_DEFAULT_MS, 1000, 10 * 60 * 1000);
}

function clearShockerCache() {
  shockerCache.value = null;
  shockerCache.expiresAt = 0;
  shockerCache.inFlight = null;
}

async function getShockersLive() {
  const candidates = [
    "/2/shockers/own",
    "/1/shockers/own",
    "/2/shockers",
    "/1/shockers"
  ];

  const errors = [];
  for (const p of candidates) {
    try {
      const result = await requestOpenShock("GET", p);
      if (result.statusCode >= 200 && result.statusCode < 300) {
        const shockers = normalizeShockers(result.body);
        if (shockers.length) return { source: p, shockers, fetchedAt: new Date().toISOString(), durationMs: result.durationMs };
      }
      errors.push(`${p}: HTTP ${result.statusCode}`);
    } catch (err) {
      errors.push(`${p}: ${err.message}`);
    }
  }

  const fallback = fs.existsSync(SHOCKERS_PATH) ? SHOCKERS_PATH : LEGACY_SHOCKERS_PATH;
  if (fs.existsSync(fallback)) {
    const shockers = JSON.parse(fs.readFileSync(fallback, "utf8"));
    return { source: path.relative(APP_ROOT, fallback).replace(/\\/g, "/"), shockers, fetchedAt: new Date().toISOString(), warning: errors.length ? `OpenShock unavailable, using fallback. ${errors[0]}` : undefined };
  }

  return {
    source: "none",
    shockers: [],
    fetchedAt: new Date().toISOString(),
    warning: "Could not auto-read shockers. Create config/shockers.json as fallback.",
    errors
  };
}

async function getShockers({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && shockerCache.value && now < shockerCache.expiresAt) {
    debugState.counters.openShockCacheHits += 1;
    return { ...shockerCache.value, cached: true, cacheExpiresInMs: Math.max(0, shockerCache.expiresAt - now) };
  }

  if (!forceRefresh && shockerCache.inFlight) {
    debugState.counters.openShockSharedInFlight += 1;
    const value = await shockerCache.inFlight;
    return { ...value, cached: true, sharedInFlight: true, cacheExpiresInMs: Math.max(0, shockerCache.expiresAt - Date.now()) };
  }

  debugState.counters.openShockCacheMisses += 1;

  shockerCache.inFlight = getShockersLive()
    .then(value => {
      shockerCache.value = value;
      shockerCache.expiresAt = Date.now() + shockerCacheTtlMs();
      shockerCache.lastError = null;
      return value;
    })
    .catch(err => {
      shockerCache.lastError = err.message;
      if (shockerCache.value) {
        return { ...shockerCache.value, cached: true, stale: true, warning: `OpenShock refresh failed, using stale cached shockers. ${err.message}` };
      }
      throw err;
    })
    .finally(() => {
      shockerCache.inFlight = null;
    });

  const value = await shockerCache.inFlight;
  return { ...value, cached: false, cacheExpiresInMs: Math.max(0, shockerCache.expiresAt - Date.now()) };
}

function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function handleControl(req, res) {
  const body = await readBody(req);
  const s = safety();

  const id = String(body.id || "");
  const duration = clampInt(
    body.duration,
    s.minDurationMs ?? 300,
    s.maxDurationMs ?? 1000
  );
  const exclusive = Boolean(body.exclusive ?? true);

  // Game convention:
  // selectedValue 0 = Vibrate
  // selectedValue 1-80 = Shock intensity
  const selectedValue = clampInt(body.selectedValue, 0, s.serverMaxShockIntensity ?? 80);

  if (!id) return sendJson(res, 400, { error: "Missing shocker id" });

  const type = selectedValue === 0 ? "Vibrate" : "Shock";
  const intensity = selectedValue === 0
    ? clampInt(s.serverMaxVibrateIntensity ?? 100, 1, 100)
    : selectedValue;

  const requestBody = {
    shocks: [{ id, type, intensity, duration, exclusive }]
  };

  debugState.counters.shockCommands += 1;
  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: type === "Vibrate" ? "vibrate" : "shock" });
  sendJson(res, result.statusCode, {
    sent: { id, type, intensity, selectedValue, duration, exclusive },
    openshock: result.body
  });
}

async function handleStopAll(req, res) {
  const body = await readBody(req);
  const s = safety();
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return sendJson(res, 400, { error: "No shocker ids supplied" });

  const requestBody = {
    shocks: ids.map(id => ({
      id,
      type: "Stop",
      intensity: 0,
      duration: s.minDurationMs ?? 300,
      exclusive: true
    }))
  };

  debugState.counters.stopCommands += 1;
  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: "stop" });
  sendJson(res, result.statusCode, { stopped: ids.length, openshock: result.body });
}

