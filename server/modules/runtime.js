// Extracted from server/app.js. Loaded by server/app.js in order.
// OpenShock Roulette - local web server and OpenShock API proxy
// Run in PowerShell:
//   Copy .env.example to .env, fill OPENSHOCK_API_TOKEN, then run:
//   npm install
//   npm start

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var os = require("os");
var QRCode = require("qrcode");
var APP_ROOT = path.resolve(__dirname, "..");
var PACKAGE_JSON = require("../package.json");
var { createServerPaths } = require("./paths");
var { sendDiagnosticsHtml, serveHtmlFile, serveRoleStaticFile, serveStaticFile } = require("./static-files");

var APP_VERSION = String(PACKAGE_JSON.version || "0.0.0");
var APP_USER_AGENT = `OpenShock-Roulette/${APP_VERSION} (local-party-game)`;

loadEnvFile(path.join(APP_ROOT, ".env"));

var {
  CONFIG_DIR,
  CONFIG_EXAMPLE_PATH,
  EVENT_CARDS_EXAMPLE_PATH,
  CONFIG_PATH,
  EVENT_CARDS_PATH,
  OBJECTIVES_PATH,
  OBJECTIVES_EXAMPLE_PATH,
  SHOCKERS_EXAMPLE_PATH,
  SHOCKERS_PATH,
  LEGACY_SHOCKERS_PATH,
  LEGACY_SESSION_STATE_PATH,
  DATA_DIR,
  DB_PATH,
  SESSION_ARCHIVE_DIR,
  LOG_DIR
} = createServerPaths(APP_ROOT, process.env);

var OSR_SCHEMA_VERSION = "7";
var MAX_DEBUG_RING_SIZE = clampNumber(process.env.DEBUG_RING_SIZE || 250, 50, 5000);

var debugState = {
  startedAt: new Date().toISOString(),
  incomingRequests: [],
  slowRequests: [],
  openShockCalls: [],
  counters: {
    incomingTotal: 0,
    incomingErrors: 0,
    slowRequests: 0,
    openShockTotal: 0,
    openShockErrors: 0,
    openShockTimeouts: 0,
    openShockCacheHits: 0,
    openShockCacheMisses: 0,
    openShockSharedInFlight: 0,
    shockCommands: 0,
    stopCommands: 0
  },
  openShockDurations: []
};

function clampNumber(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function debugConfig() {
  const cfg = readConfig?.() || {};
  return {
    enabled: cfg.debug?.enabled ?? process.env.OSR_DEBUG_ENABLED !== "false",
    logIncomingRequests: cfg.debug?.logIncomingRequests ?? process.env.OSR_LOG_INCOMING !== "false",
    logOpenShockRequests: cfg.debug?.logOpenShockRequests ?? process.env.OSR_LOG_OPENSHOCK !== "false",
    logSlowRequests: cfg.debug?.logSlowRequests ?? process.env.OSR_LOG_SLOW !== "false",
    slowRequestThresholdMs: clampNumber(cfg.debug?.slowRequestThresholdMs ?? process.env.OSR_SLOW_REQUEST_MS ?? 1000, 50, 60000),
    includeQueryString: cfg.debug?.includeQueryString ?? process.env.OSR_LOG_QUERY !== "false"
  };
}

function pushRing(name, entry) {
  const arr = debugState[name];
  if (!Array.isArray(arr)) return;
  arr.push(entry);
  while (arr.length > MAX_DEBUG_RING_SIZE) arr.shift();
}

function appendJsonLine(fileName, entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, fileName), JSON.stringify(entry) + os.EOL, "utf8");
  } catch (err) {
    console.warn(`Could not write debug log ${fileName}: ${err.message}`);
  }
}

function logIncomingRequest(entry) {
  const dbg = debugConfig();
  if (!dbg.enabled || !dbg.logIncomingRequests) return;
  pushRing("incomingRequests", entry);
  appendJsonLine("incoming-api.log", entry);
}

function logSlowRequest(entry) {
  const dbg = debugConfig();
  if (!dbg.enabled || !dbg.logSlowRequests) return;
  pushRing("slowRequests", entry);
  appendJsonLine("slow-requests.log", entry);
}

function logOpenShockCall(entry) {
  const dbg = debugConfig();
  if (!dbg.enabled || !dbg.logOpenShockRequests) return;
  pushRing("openShockCalls", entry);
  appendJsonLine("openshock-api.log", entry);
}

function safeRequestPath(req, url) {
  const dbg = debugConfig();
  if (!url) return req.url || "";
  return dbg.includeQueryString ? `${url.pathname}${url.search || ""}` : url.pathname;
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function getDebugSnapshot() {
  const now = Date.now();
  const cacheAgeMs = shockerCache?.value?.fetchedAt ? Math.max(0, now - Date.parse(shockerCache.value.fetchedAt)) : null;
  return {
    startedAt: debugState.startedAt,
    now: new Date().toISOString(),
    config: debugConfig(),
    counters: { ...debugState.counters },
    averages: {
      openShockResponseMs: average(debugState.openShockDurations),
      incomingResponseMs: average(debugState.incomingRequests.map(r => r.responseTimeMs).filter(Number.isFinite))
    },
    cache: {
      hasShockers: Boolean(shockerCache?.value),
      cachedShockers: shockerCache?.value?.shockers?.length || 0,
      source: shockerCache?.value?.source || null,
      fetchedAt: shockerCache?.value?.fetchedAt || null,
      cacheAgeMs,
      expiresAt: shockerCache?.expiresAt ? new Date(shockerCache.expiresAt).toISOString() : null,
      expiresInMs: shockerCache?.expiresAt ? Math.max(0, shockerCache.expiresAt - now) : 0,
      inFlight: Boolean(shockerCache?.inFlight),
      lastError: shockerCache?.lastError || null
    },
    recent: {
      incomingRequests: debugState.incomingRequests.slice(-25).reverse(),
      slowRequests: debugState.slowRequests.slice(-25).reverse(),
      openShockCalls: debugState.openShockCalls.slice(-25).reverse()
    },
    logs: {
      directory: path.relative(APP_ROOT, LOG_DIR).replace(/\\/g, "/"),
      incoming: "logs/incoming-api.log",
      openshock: "logs/openshock-api.log",
      slow: "logs/slow-requests.log"
    }
  };
}



function ensureLocalFilesFromExamples() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  function copyIfMissing(examplePath, targetPath) {
    if (!fs.existsSync(targetPath) && fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, targetPath);
      console.log(`Created ${path.relative(APP_ROOT, targetPath).replace(/\\/g, "/")} from ${path.relative(APP_ROOT, examplePath).replace(/\\/g, "/")}`);
    }
  }

  if (!fs.existsSync(path.join(APP_ROOT, ".env")) && fs.existsSync(path.join(APP_ROOT, ".env.example"))) {
    fs.copyFileSync(path.join(APP_ROOT, ".env.example"), path.join(APP_ROOT, ".env"));
    console.log("Created .env from .env.example");
  }

  copyIfMissing(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
  copyIfMissing(EVENT_CARDS_EXAMPLE_PATH, EVENT_CARDS_PATH);
  copyIfMissing(OBJECTIVES_EXAMPLE_PATH, OBJECTIVES_PATH);
  copyIfMissing(SHOCKERS_EXAMPLE_PATH, SHOCKERS_PATH);
}

// Example JSON files are kept under config/. Live config/catalog files are created
// from config/*.example.json and runtime session state is stored as SQLite JSON blobs.
// Root-level legacy config/catalog files are intentionally ignored so duplicate
// root files cannot accidentally become the active source.
ensureLocalFilesFromExamples();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

