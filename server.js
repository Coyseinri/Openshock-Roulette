// OpenShock Roulette - local web server and OpenShock API proxy
// Run in PowerShell:
//   $env:OPENSHOCK_TOKEN = "your_token_here"
//   node server.js

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

let CONFIG = readConfig();

const PORT = process.env.PORT || CONFIG.server?.port || 8787;
const TOKEN = process.env.OPENSHOCK_TOKEN || "";
const API_HOST = process.env.OPENSHOCK_API_HOST || CONFIG.server?.apiHost || "api.openshock.app";
const USER_AGENT = process.env.OPENSHOCK_USER_AGENT || CONFIG.server?.userAgent || "OpenShock-Roulette/1.0 (local-party-game)";

function safety() {
  CONFIG = readConfig();
  return CONFIG.safety || {};
}

function sendJson(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
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

function requestOpenShock(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    if (!TOKEN) {
      reject(new Error("Missing OPENSHOCK_TOKEN environment variable"));
      return;
    }

    const postData = body ? JSON.stringify(body) : "";
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

    const req = https.request(options, res => {
      let responseData = "";
      res.on("data", chunk => responseData += chunk);
      res.on("end", () => {
        let parsed = responseData;
        try { parsed = responseData ? JSON.parse(responseData) : null; } catch {}
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });

    req.on("error", reject);
    if (body) req.write(postData);
    req.end();
  });
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

async function getShockers() {
  const candidates = [
    "/1/shockers/own",
    "/2/shockers/own",
    "/1/shockers",
    "/2/shockers"
  ];

  for (const p of candidates) {
    try {
      const result = await requestOpenShock("GET", p);
      if (result.statusCode >= 200 && result.statusCode < 300) {
        const shockers = normalizeShockers(result.body);
        if (shockers.length) return { source: p, shockers };
      }
    } catch {}
  }

  const fallback = path.join(__dirname, "shockers.json");
  if (fs.existsSync(fallback)) {
    const shockers = JSON.parse(fs.readFileSync(fallback, "utf8"));
    return { source: "shockers.json", shockers };
  }

  return {
    source: "none",
    shockers: [],
    warning: "Could not auto-read shockers. Create shockers.json next to server.js as fallback."
  };
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

  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody);
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

  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody);
  sendJson(res, result.statusCode, { stopped: ids.length, openshock: result.body });
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object");
  if (!Array.isArray(config.fateWheel)) throw new Error("config.fateWheel must be an array");
  if (!config.fateWheel.length) throw new Error("config.fateWheel must not be empty");

  const maxShock = clampInt(config.safety?.serverMaxShockIntensity ?? 100, 1, 100);

  config.fateWheel.forEach((f, i) => {
    if (!f.key || !f.name) throw new Error(`fateWheel[${i}] needs key and name`);
    f.min = clampInt(f.min, 0, maxShock);
    f.max = clampInt(f.max, 0, maxShock);
    if (f.max < f.min) [f.min, f.max] = [f.max, f.min];
    f.weight = clampInt(f.weight, 0, 1000);
    f.enabled = Boolean(f.enabled ?? true);
    if (!["down", "neutral", "up"].includes(f.escalates)) f.escalates = "neutral";
  });

  return config;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === "/api/config" && req.method === "GET") {
      CONFIG = readConfig();
      return sendJson(res, 200, CONFIG);
    }

    if (url.pathname === "/api/config" && req.method === "POST") {
      const incoming = await readBody(req);
      const validated = validateConfig(incoming);
      writeConfig(validated);
      CONFIG = validated;
      return sendJson(res, 200, { saved: true, config: CONFIG });
    }

    if (url.pathname === "/api/shockers" && req.method === "GET") {
      return sendJson(res, 200, await getShockers());
    }

    if (url.pathname === "/api/control" && req.method === "POST") {
      return await handleControl(req, res);
    }

    if (url.pathname === "/api/stop-all" && req.method === "POST") {
      return await handleStopAll(req, res);
    }

    const requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const safeRoot = path.resolve(__dirname);
    const filePath = path.resolve(safeRoot, requestedPath);

    // Prevent path traversal while still working correctly on Windows path separators.
    if (!filePath.startsWith(safeRoot + path.sep) && filePath !== safeRoot) {
      return sendJson(res, 403, { error: "Forbidden" });
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return sendJson(res, 404, { error: "Not found", path: requestedPath });
    }

    const ext = path.extname(filePath).toLowerCase();
    const type =
      ext === ".html" ? "text/html; charset=utf-8" :
      ext === ".css" ? "text/css; charset=utf-8" :
      ext === ".js" ? "application/javascript; charset=utf-8" :
      ext === ".json" ? "application/json; charset=utf-8" :
      ext === ".svg" ? "image/svg+xml" :
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`${CONFIG.app?.serverBanner || CONFIG.app?.displayTitle || 'OpenShock Roulette'} running at http://localhost:${PORT}`);
  console.log(`Config file: ${CONFIG_PATH}`);
  if (!TOKEN) console.log("WARNING: OPENSHOCK_TOKEN is not set.");
});