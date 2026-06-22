// OpenShock Roulette - local web server and OpenShock API proxy
// Run in PowerShell:
//   Copy .env.example to .env, fill OPENSHOCK_API_TOKEN, then run:
//   npm install
//   npm start

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const QRCode = require("qrcode");

loadEnvFile(path.join(__dirname, ".env"));

const CONFIG_DIR = path.join(__dirname, "config");
const CONFIG_EXAMPLE_PATH = path.join(CONFIG_DIR, "config.example.json");
const EVENT_CARDS_EXAMPLE_PATH = path.join(CONFIG_DIR, "event-cards.example.json");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const EVENT_CARDS_PATH = path.join(CONFIG_DIR, "event-cards.json");
const OBJECTIVES_PATH = path.join(CONFIG_DIR, "objectives.json");
const OBJECTIVES_EXAMPLE_PATH = path.join(CONFIG_DIR, "objectives.example.json");
const SHOCKERS_EXAMPLE_PATH = path.join(CONFIG_DIR, "shockers.example.json");
const SHOCKERS_PATH = path.join(CONFIG_DIR, "shockers.json");
const LEGACY_SHOCKERS_PATH = path.join(__dirname, "shockers.json");
const LEGACY_SESSION_STATE_PATH = path.join(__dirname, "session-state.json");
const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_DB_PATH = path.join(DATA_DIR, "osr.db");
const DB_PATH = path.resolve(__dirname, process.env.OSR_DB_PATH || process.env.DB_PATH || DEFAULT_DB_PATH);
const OSR_SCHEMA_VERSION = "7";
const SESSION_ARCHIVE_DIR = path.join(__dirname, "session-archive");

const LOG_DIR = path.join(__dirname, "logs");
const MAX_DEBUG_RING_SIZE = clampNumber(process.env.DEBUG_RING_SIZE || 250, 50, 5000);

const debugState = {
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
      directory: path.relative(__dirname, LOG_DIR).replace(/\\/g, "/"),
      incoming: "logs/incoming-api.log",
      openshock: "logs/openshock-api.log",
      slow: "logs/slow-requests.log"
    }
  };
}



function sendDiagnosticsHtml(res) {
  const filePath = path.join(__dirname, "diagnostics.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
}

function ensureLocalFilesFromExamples() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  function copyIfMissing(examplePath, targetPath) {
    if (!fs.existsSync(targetPath) && fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, targetPath);
      console.log(`Created ${path.relative(__dirname, targetPath).replace(/\\/g, "/")} from ${path.relative(__dirname, examplePath).replace(/\\/g, "/")}`);
    }
  }

  if (!fs.existsSync(path.join(__dirname, ".env")) && fs.existsSync(path.join(__dirname, ".env.example"))) {
    fs.copyFileSync(path.join(__dirname, ".env.example"), path.join(__dirname, ".env"));
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

let DB = null;

const { initializeDatabase, readObjectivesFileNormalized, appendLog } = require("./server/database-init");

function getDatabase() {
  if (DB) return DB;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  try {
    const BetterSqlite3 = require("better-sqlite3");
    DB = new BetterSqlite3(DB_PATH);
    DB.pragma("journal_mode = WAL");
    DB.pragma("foreign_keys = OFF");
  } catch (betterSqliteErr) {
    try {
      const { DatabaseSync } = require("node:sqlite");
      DB = new DatabaseSync(DB_PATH);
      DB.exec("PRAGMA journal_mode = WAL");
      DB.exec("PRAGMA foreign_keys = OFF");
    } catch (nodeSqliteErr) {
      throw new Error(
        "Missing SQLite support. Run `npm install` to install better-sqlite3, or use Node.js 22+ with node:sqlite. " +
        `better-sqlite3: ${betterSqliteErr.message}; node:sqlite: ${nodeSqliteErr.message}`
      );
    }
  }

  initializeDatabase(DB, {
    schemaVersion: OSR_SCHEMA_VERSION,
    appVersion: "1.3.0",
    objectivesPath: OBJECTIVES_PATH,
    objectivesExamplePath: OBJECTIVES_EXAMPLE_PATH,
    configExamplePath: CONFIG_EXAMPLE_PATH,
    eventCardsExamplePath: EVENT_CARDS_EXAMPLE_PATH
  });

  return DB;
}

function readObjectivesFromDatabase() {
  return null;
}

function readHiddenRolesFromDatabase() {
  return null;
}

function getStateValue(key) {
  const row = getDatabase().prepare("SELECT value FROM state WHERE key = ?").get(key);
  if (!row) return null;
  return JSON.parse(row.value);
}

function setStateValue(key, value) {
  const serialized = JSON.stringify(value);
  getDatabase().prepare(`
    INSERT INTO state (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, serialized);
}

function markMeta(key, value) {
  getDatabase().prepare(`
    INSERT INTO meta (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, String(value));
}

function getMeta(key) {
  const row = getDatabase().prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function getCurrentGameId() {
  const existing = getMeta("currentGameId");
  if (existing) return existing;
  const id = `game-${new Date().toISOString().slice(0, 10)}-default`;
  markMeta("currentGameId", id);
  return id;
}

function dbJson(value) {
  return JSON.stringify(value ?? {});
}


function writeRoundResult(result = {}) {
  appendLog(getDatabase(), "roundResult", "Round result", result?.notes || null, result || {});
}

function writeDatabaseEvent(event = {}) {
  appendLog(getDatabase(), event.type || event.event_type || "event", event.title || null, event.description || null, event || {});
}

function writeObjectiveEventDatabase(event = {}) {
  appendLog(getDatabase(), "objectiveEvent", event.title || event.objectiveId || null, event.rewardDescription || null, event || {});
}

function syncKnownDevicesToDatabase(_shockers = [], _state = null) {
  // SQLite blob mode: devices live in shockers/config JSON and runtime state, not relational tables.
}

function updatePlayerMultiplierInDatabase(_playerId, _multiplierPercent, _displayName = null) {
  // SQLite blob mode: multipliers are saved in the session blob by writeSessionState().
}

function writePointLedger(state, playerId, delta, reason, metadata = {}) {
  appendLog(getDatabase(), "pointLedger", reason || "points", null, { playerId, delta, balance: state?.playerPoints?.[playerId] ?? 0, metadata });
}

function writeTokenLedger(state, playerId, tokenType, delta, reason, metadata = {}) {
  appendLog(getDatabase(), "tokenLedger", reason || "tokens", null, { playerId, tokenType, delta, balance: state?.playerTokens?.[playerId]?.[tokenType] ?? 0, metadata });
}

function writePurchaseLog(state, playerId, itemType, itemKey, costPoints, metadata = {}) {
  appendLog(getDatabase(), "purchase", `${itemType || "item"}:${itemKey || "unknown"}`, null, { playerId, itemType, itemKey, costPoints, metadata });
}

function upsertPointBalanceDatabase() {
  // SQLite blob mode: runtime data is stored inside the session blob.
}

function upsertTokenBalanceDatabase() {
  // SQLite blob mode: runtime data is stored inside the session blob.
}

function upsertPlayerStatsDatabase() {
  // SQLite blob mode: runtime data is stored inside the session blob.
}

function makeAccessCode(prefix = "role") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function defaultSessionState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roundNumber: 0,
    eliminatedIds: [],
    playerStats: {},
    lastSelectedTargetIds: [],
    lastShockedTargetIds: [],
    lastTargetPicked: null,
    fateDeckKeys: [],
    objectiveAssignments: {},
    playerPoints: {},
    playerTokens: {},
    playerMultipliers: {},
    pendingRoundModifiers: [],
    pendingPlayerActions: [],
    hiddenRoles: {},
    completedObjectiveEvents: [],
    audienceVotes: [],
    audienceSessions: {},
    audienceEventLog: [],
    hostCommands: [],
    hostPaused: false,
    roleAccessKeys: {}
  };
}

function validateSessionState(data) {
  const base = defaultSessionState();
  if (!data || typeof data !== "object") return base;

  const state = {
    ...base,
    ...data,
    version: 1,
    updatedAt: new Date().toISOString(),
    roundNumber: clampInt(data.roundNumber ?? 0, 0, 1000000),
    eliminatedIds: Array.isArray(data.eliminatedIds) ? data.eliminatedIds.map(String).filter(Boolean) : [],
    lastSelectedTargetIds: Array.isArray(data.lastSelectedTargetIds) ? data.lastSelectedTargetIds.map(String).filter(Boolean) : [],
    lastShockedTargetIds: Array.isArray(data.lastShockedTargetIds) ? data.lastShockedTargetIds.map(String).filter(Boolean) : [],
    playerStats: data.playerStats && typeof data.playerStats === "object" ? data.playerStats : {},
    fateDeckKeys: Array.isArray(data.fateDeckKeys) ? data.fateDeckKeys.map(String).filter(Boolean) : [],
    lastTargetPicked: data.lastTargetPicked && typeof data.lastTargetPicked === "object" ? data.lastTargetPicked : null
  };

  const cleanStats = {};
  for (const [id, stats] of Object.entries(state.playerStats)) {
    if (!id || !stats || typeof stats !== "object") continue;
    cleanStats[String(id)] = {
      selected: clampInt(stats.selected ?? 0, 0, 1000000),
      shocked: clampInt(stats.shocked ?? 0, 0, 1000000),
      vibes: clampInt(stats.vibes ?? 0, 0, 1000000),
      safe: clampInt(stats.safe ?? 0, 0, 1000000),
      allTargeted: clampInt(stats.allTargeted ?? 0, 0, 1000000),
      totalIntensity: clampInt(stats.totalIntensity ?? 0, 0, 100000000),
      bodyguards: clampInt(stats.bodyguards ?? 0, 0, 1000000),
      cursesUsed: clampInt(stats.cursesUsed ?? 0, 0, 1000000),
      chaosUsed: clampInt(stats.chaosUsed ?? 0, 0, 1000000),
      tokensBought: clampInt(stats.tokensBought ?? 0, 0, 1000000),
      tokensOwned: clampInt(stats.tokensOwned ?? 0, 0, 1000000),
      highPlusSurvived: clampInt(stats.highPlusSurvived ?? 0, 0, 1000000),
      eventCardsExperienced: clampInt(stats.eventCardsExperienced ?? 0, 0, 1000000),
      sabotageEffects: clampInt(stats.sabotageEffects ?? 0, 0, 1000000),
      redirectedHits: clampInt(stats.redirectedHits ?? 0, 0, 1000000),
      lastSelectedRound: clampInt(stats.lastSelectedRound ?? 0, 0, 1000000),
      lastShockedRound: clampInt(stats.lastShockedRound ?? 0, 0, 1000000),
      lastVibeRound: clampInt(stats.lastVibeRound ?? 0, 0, 1000000)
    };
  }
  state.playerStats = cleanStats;
  state.objectiveAssignments = data.objectiveAssignments && typeof data.objectiveAssignments === "object" ? data.objectiveAssignments : {};
  state.playerPoints = data.playerPoints && typeof data.playerPoints === "object" ? data.playerPoints : {};
  state.playerTokens = data.playerTokens && typeof data.playerTokens === "object" ? data.playerTokens : {};
  state.playerMultipliers = data.playerMultipliers && typeof data.playerMultipliers === "object" ? data.playerMultipliers : {};
  for (const [id, value] of Object.entries(state.playerMultipliers)) {
    state.playerMultipliers[id] = clampInt(value ?? 100, 0, 100);
  }
  state.pendingRoundModifiers = Array.isArray(data.pendingRoundModifiers) ? data.pendingRoundModifiers : [];
  state.pendingPlayerActions = Array.isArray(data.pendingPlayerActions) ? data.pendingPlayerActions : [];
  state.hiddenRoles = data.hiddenRoles && typeof data.hiddenRoles === "object" ? data.hiddenRoles : {};
  state.rolePassiveState = data.rolePassiveState && typeof data.rolePassiveState === "object" ? data.rolePassiveState : {};
  state.completedObjectiveEvents = Array.isArray(data.completedObjectiveEvents) ? data.completedObjectiveEvents : [];
  state.audienceVotes = Array.isArray(data.audienceVotes) ? data.audienceVotes : [];
  state.audienceSessions = data.audienceSessions && typeof data.audienceSessions === "object" ? data.audienceSessions : {};
  state.audienceEventLog = Array.isArray(data.audienceEventLog) ? data.audienceEventLog.slice(-250) : [];
  state.hostCommands = Array.isArray(data.hostCommands) ? data.hostCommands : [];
  state.hostPaused = Boolean(data.hostPaused ?? false);
  state.roleAccessKeys = data.roleAccessKeys && typeof data.roleAccessKeys === "object" ? data.roleAccessKeys : {};
  if (!state.roleAccessKeys.host) state.roleAccessKeys.host = makeAccessCode("host");
  if (!state.roleAccessKeys.audience) state.roleAccessKeys.audience = makeAccessCode("audience");
  if (!state.roleAccessKeys.playerKeys || typeof state.roleAccessKeys.playerKeys !== "object") state.roleAccessKeys.playerKeys = {};

  return evaluateObjectives(evaluateHiddenRoles(state));
}

function hydrateSessionFromStructuredDatabase(state) {
  return state;
}

function readSessionState() {
  const existing = getStateValue("session");
  if (existing) return hydrateSessionFromStructuredDatabase(validateSessionState(existing));

  // v1.3.0 schema v7 stores the full live session as a SQLite JSON blob.
  const fresh = defaultSessionState();
  writeSessionState(fresh);
  return fresh;
}


function mergePlayerStatsForSessionSave(incomingStats, currentStats) {
  const statNames = [
    "selected", "shocked", "vibes", "safe", "allTargeted", "totalIntensity",
    "bodyguards", "cursesUsed", "chaosUsed", "tokensBought", "tokensOwned", "highPlusSurvived", "eventCardsExperienced", "sabotageEffects", "redirectedHits",
    "lastSelectedRound", "lastShockedRound", "lastVibeRound"
  ];
  const merged = {};
  const ids = new Set([
    ...Object.keys(currentStats && typeof currentStats === "object" ? currentStats : {}),
    ...Object.keys(incomingStats && typeof incomingStats === "object" ? incomingStats : {})
  ]);
  for (const id of ids) {
    const current = currentStats?.[id] && typeof currentStats[id] === "object" ? currentStats[id] : {};
    const incoming = incomingStats?.[id] && typeof incomingStats[id] === "object" ? incomingStats[id] : {};
    merged[id] = {};
    for (const name of statNames) {
      // Host browser saves can be stale for stats that are changed by player/audience/host APIs.
      // Keeping the highest counter prevents hidden-role progress from being rolled back by a later round save.
      merged[id][name] = Math.max(
        clampInt(current[name] ?? 0, 0, name === "totalIntensity" ? 100000000 : 1000000),
        clampInt(incoming[name] ?? 0, 0, name === "totalIntensity" ? 100000000 : 1000000)
      );
    }
  }
  return merged;
}

function syncSessionToStructuredDatabase(_state) {
  // SQLite blob mode: no relational sync.
}

function slimSessionStateForBlob(state) {
  return validateSessionState(state);
}

function writeSessionState(state) {
  const validated = validateSessionState(state);
  syncSessionToStructuredDatabase(validated);
  setStateValue("session", slimSessionStateForBlob(validated));
  return validated;
}

function sessionArchiveStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function archiveSessionState() {
  const current = readSessionState();
  if (!current) return null;
  if (!fs.existsSync(SESSION_ARCHIVE_DIR)) fs.mkdirSync(SESSION_ARCHIVE_DIR, { recursive: true });

  const archiveName = `session-state-${sessionArchiveStamp()}.json`;
  const archivePath = path.join(SESSION_ARCHIVE_DIR, archiveName);
  fs.writeFileSync(archivePath, JSON.stringify(current, null, 2), "utf8");

  return path.relative(__dirname, archivePath).replace(/\\/g, "/");
}

function resetSessionState() {
  const previous = readSessionState();
  const archivedTo = archiveSessionState();
  const fresh = defaultSessionState();
  // Keep role access links stable across game resets so Host/Audience QR codes do not break mid-event.
  fresh.roleAccessKeys = previous.roleAccessKeys || fresh.roleAccessKeys || {};
  const session = writeSessionState(fresh);
  return { session, archivedTo };
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

function getPublicBaseUrl(req) {
  CONFIG = readConfig();
  const configured = String(CONFIG.server?.publicBaseUrl || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const host = req.headers.host || `localhost:${PORT}`;
  const lan = getLanAddresses()[0];
  if (lan) {
    const port = String(host).includes(":") ? String(host).split(":").pop() : PORT;
    return `http://${lan}:${port}`;
  }
  return `http://${host}`;
}

function isLocalRequest(req) {
  const addr = String(req.socket.remoteAddress || "");
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr === "localhost";
}

function pageEnabledFromConfig(cfg, defaultEnabled = true) {
  // Consolidated page/QR behavior:
  // one setting controls the page, and QR codes follow that setting.
  // Legacy qrCodesEnabled is ignored except for old configs where enabled is missing.
  const enabled = Boolean(cfg.enabled ?? cfg.qrCodesEnabled ?? defaultEnabled);
  return { enabled, qrCodesEnabled: enabled };
}

function playerPagesConfig() {
  CONFIG = readConfig();
  const cfg = CONFIG.playerPages || {};
  const page = pageEnabledFromConfig(cfg, true);
  return {
    enabled: page.enabled,
    qrCodesEnabled: page.qrCodesEnabled,
    autoRefreshMs: clampInt(cfg.autoRefreshMs ?? 2000, 500, 30000),
    useShockerIdAsAccessKey: Boolean(cfg.useShockerIdAsAccessKey ?? false)
  };
}

function economyConfig() {
  CONFIG = readConfig();
  const cfg = CONFIG.economy || {};
  const tokenCosts = {
    shield: clampInt(cfg.tokenCosts?.shield ?? cfg.shieldTokenCost ?? cfg.shieldCost ?? 8, 0, 999),
    mercy: clampInt(cfg.tokenCosts?.mercy ?? cfg.mercyTokenCost ?? cfg.mercyCost ?? 6, 0, 999),
    blessing: clampInt(cfg.tokenCosts?.blessing ?? cfg.blessingTokenCost ?? cfg.blessingCost ?? 5, 0, 999),
    curse: clampInt(cfg.tokenCosts?.curse ?? cfg.curseTokenCost ?? cfg.curseCost ?? 5, 0, 999),
    chaos: clampInt(cfg.tokenCosts?.chaos ?? cfg.chaosTokenCost ?? 10, 0, 999),
    guarantee: clampInt(cfg.tokenCosts?.guarantee ?? cfg.guaranteeTokenCost ?? cfg.guaranteedPickCost ?? 12, 0, 999),
    immunity: clampInt(cfg.tokenCosts?.immunity ?? cfg.immunityTokenCost ?? 10, 0, 999),
    doubleShock: clampInt(cfg.tokenCosts?.doubleShock ?? cfg.doubleShockTokenCost ?? 10, 0, 999)
  };
  return {
    objectiveRewardPoints: clampInt(cfg.objectiveRewardPoints ?? 3, 0, 999),
    bodyguardRewardPoints: clampInt(cfg.bodyguardRewardPoints ?? 2, 0, 999),
    blessingCost: clampInt(cfg.blessingCost ?? tokenCosts.blessing, 0, 999),
    curseCost: clampInt(cfg.curseCost ?? tokenCosts.curse, 0, 999),
    shieldCost: clampInt(cfg.shieldCost ?? tokenCosts.shield, 0, 999),
    mercyCost: clampInt(cfg.mercyCost ?? tokenCosts.mercy, 0, 999),
    audienceTokenGrantAmount: clampInt(cfg.audienceTokenGrantAmount ?? 1, 1, 20),
    audienceVoteThreshold: clampInt(cfg.audienceVoteThreshold ?? 3, 1, 1000),
    audienceCooldownSeconds: clampInt(cfg.audienceCooldownSeconds ?? 20, 0, 3600),
    audienceMaxVotesPerRound: clampInt(cfg.audienceMaxVotesPerRound ?? 1, 1, 100),
    hostDefaultPointDonation: clampInt(cfg.hostDefaultPointDonation ?? 1, 0, 999),
    hostDefaultTokenDonationAmount: clampInt(cfg.hostDefaultTokenDonationAmount ?? 1, 1, 99),
    tokenTypes: ["shield", "mercy", "blessing", "curse", "chaos", "guarantee", "immunity", "doubleShock"],
    tokenCosts
  };
}

function normalizeTokenType(tokenType) {
  const raw = String(tokenType || "").trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = {
    shield: "shield",
    mercy: "mercy",
    blessing: "blessing",
    bless: "blessing",
    curse: "curse",
    chaos: "chaos",
    guarantee: "guarantee",
    guaranteedpick: "guarantee",
    immunity: "immunity",
    immune: "immunity",
    doubleshock: "doubleShock",
    forceddoubleshock: "doubleShock",
    doubledshock: "doubleShock"
  };
  const canonical = aliases[key] || raw;
  return economyConfig().tokenTypes.includes(canonical) ? canonical : null;
}

function readObjectives() {
  return readObjectivesFileNormalized();
}

function statValueForObjective(stats, objective, state) {
  stats = stats || {};
  switch (objective.type) {
    case "selected": return clampInt(stats.selected ?? 0, 0, 1000000);
    case "shocked": return clampInt(stats.shocked ?? 0, 0, 1000000);
    case "vibes": return clampInt(stats.vibes ?? 0, 0, 1000000);
    case "safe": return clampInt(stats.safe ?? 0, 0, 1000000);
    case "allTargeted": return clampInt(stats.allTargeted ?? 0, 0, 1000000);
    case "totalIntensity": return clampInt(stats.totalIntensity ?? 0, 0, 100000000);
    case "bodyguards": return clampInt(stats.bodyguards ?? 0, 0, 1000000);
    case "cursesUsed": return clampInt(stats.cursesUsed ?? 0, 0, 1000000);
    case "chaosUsed": return clampInt(stats.chaosUsed ?? 0, 0, 1000000);
    case "tokensBought": return clampInt(stats.tokensBought ?? 0, 0, 1000000);
    case "roundsSinceSelected": return stats.lastSelectedRound ? Math.max(0, clampInt(state.roundNumber ?? 0, 0, 1000000) - clampInt(stats.lastSelectedRound, 0, 1000000)) : 0;
    case "roundsSinceShocked": return stats.lastShockedRound ? Math.max(0, clampInt(state.roundNumber ?? 0, 0, 1000000) - clampInt(stats.lastShockedRound, 0, 1000000)) : 0;
    default: return clampInt(stats[objective.type] ?? 0, 0, 100000000);
  }
}

const CUMULATIVE_OBJECTIVE_TYPES = new Set(["selected", "shocked", "vibes", "safe", "allTargeted", "totalIntensity", "bodyguards", "cursesUsed", "chaosUsed", "tokensBought", "tokensOwned", "highPlusSurvived", "eventCardsExperienced", "sabotageEffects", "redirectedHits"]);

function objectiveBaselineValue(stats, objective, state) {
  return CUMULATIVE_OBJECTIVE_TYPES.has(String(objective?.type || ""))
    ? statValueForObjective(stats, objective, state)
    : 0;
}

function objectiveProgressValue(stats, objective, state, assignment = {}) {
  const current = statValueForObjective(stats, objective, state);
  if (!CUMULATIVE_OBJECTIVE_TYPES.has(String(objective?.type || ""))) return current;
  return Math.max(0, current - clampInt(assignment.baseline ?? 0, 0, 100000000));
}

function makeObjectiveAssignment(def, stats, state) {
  return {
    objectiveId: def.id,
    assignedAt: new Date().toISOString(),
    baseline: objectiveBaselineValue(stats, def, state),
    progress: 0,
    target: def.target,
    completed: false,
    rewardClaimed: false
  };
}

function objectiveById(id) {
  return readObjectives().objectives.find(o => o.id === id) || null;
}

function getHiddenRoleDefs() {
  return readObjectivesFileNormalized().hiddenRoles || [];
}

function hiddenRoleById(id) {
  return getHiddenRoleDefs().find(r => r.id === id) || null;
}

function playerRoleId(state, playerId) {
  const assignment = state?.hiddenRoles?.[playerId];
  return assignment?.roleId ? String(assignment.roleId) : null;
}

function playerHasRole(state, playerId, roleId) {
  return playerRoleId(state, playerId) === String(roleId);
}

function ensureRolePassiveState(state, playerId) {
  state.rolePassiveState = state.rolePassiveState && typeof state.rolePassiveState === "object" ? state.rolePassiveState : {};
  state.rolePassiveState[playerId] = state.rolePassiveState[playerId] && typeof state.rolePassiveState[playerId] === "object" ? state.rolePassiveState[playerId] : {};
  return state.rolePassiveState[playerId];
}

function addRolePassivePoints(state, playerId, points, roleId, title, metadata = {}) {
  points = clampInt(points, 0, 999);
  if (!points) return;
  addPlayerPoints(state, playerId, points, "role_passive", { roleId, ...metadata });
  pushObjectiveEvent(state, {
    playerId,
    objectiveId: `role-passive:${roleId}:${Date.now()}`,
    title: title || `Role passive: ${roleId}`,
    rewardPoints: points,
    rewardDescription: `Role passive awarded ${points} point${points === 1 ? "" : "s"}.`
  });
}

function totalOwnedTokens(state, playerId) {
  const bucket = state?.playerTokens?.[playerId] || {};
  return Object.values(bucket).reduce((sum, v) => sum + clampInt(v, 0, 1000000), 0);
}

function roleFateKeyForValue(value) {
  value = clampInt(value, 0, 1000);
  if (value <= 0) return "vibe";
  const fate = (CONFIG?.fateWheel || []).find(f => value >= clampInt(f.min, 0, 1000) && value <= clampInt(f.max, 0, 1000));
  return fate?.key || (value >= 91 ? "deathwish" : value >= 76 ? "brutal" : value >= 61 ? "high" : value >= 36 ? "medium" : value >= 16 ? "low" : "warmup");
}

function processRolePassivesForRoundResult(state, result = {}) {
  if (!state || typeof state !== "object") return state;
  const roundNumber = clampInt(result.roundNumber ?? state.roundNumber ?? 0, 0, 1000000);
  const processedKey = `round:${roundNumber}`;
  state.rolePassiveState = state.rolePassiveState && typeof state.rolePassiveState === "object" ? state.rolePassiveState : {};
  state.rolePassiveState.__processedRoundResults = state.rolePassiveState.__processedRoundResults && typeof state.rolePassiveState.__processedRoundResults === "object" ? state.rolePassiveState.__processedRoundResults : {};
  if (state.rolePassiveState.__processedRoundResults[processedKey]) return state;
  state.rolePassiveState.__processedRoundResults[processedKey] = new Date().toISOString();

  const targets = Array.isArray(result.targets) ? result.targets : [];
  const targetIds = new Set(targets.map(t => String(t.playerId || t.id || t.deviceId || "")).filter(Boolean));
  const eventActive = Boolean(result.eventId || result.eventTitle);
  const resultType = String(result.resultType || "");

  for (const [playerId, assignment] of Object.entries(state.hiddenRoles || {})) {
    if (!assignment || typeof assignment !== "object") continue;
    const roleId = String(assignment.roleId || "");
    const roleState = ensureRolePassiveState(state, playerId);
    const isTargeted = targetIds.has(String(playerId));

    if (roleId === "survivor") {
      if (isTargeted) {
        roleState.survivorAvoidStreak = 0;
      } else {
        roleState.survivorAvoidStreak = clampInt(roleState.survivorAvoidStreak ?? 0, 0, 1000000) + 1;
        if (roleState.survivorAvoidStreak >= 3) {
          roleState.survivorAvoidStreak = 0;
          addRolePassivePoints(state, playerId, 1, roleId, "Survivor passive", { roundNumber });
        }
      }
    }

    if (roleId === "chaos-agent" && eventActive && Math.random() < 0.20) {
      addRolePassivePoints(state, playerId, 1, roleId, "Chaos Agent passive", { roundNumber, eventId: result.eventId || null });
    }
  }

  for (const target of targets) {
    const playerId = String(target.playerId || target.id || target.deviceId || "");
    if (!playerId) continue;
    const roleId = playerRoleId(state, playerId);
    const rolledValue = clampInt(target.rolledValue ?? target.value ?? result.value ?? 0, 0, 1000);
    const fateKey = roleFateKeyForValue(rolledValue);

    if (roleId === "gambler" && resultType === "shock") {
      const points = fateKey === "deathwish" ? 3 : fateKey === "brutal" ? 2 : fateKey === "high" ? 1 : 0;
      if (points > 0) {
        incrementPlayerServerStat(state, playerId, "highPlusSurvived", 1);
        addRolePassivePoints(state, playerId, points, roleId, "Gambler passive", { roundNumber, fateKey, rolledValue });
      }
    }

    if (roleId === "cultist" && eventActive) {
      incrementPlayerServerStat(state, playerId, "eventCardsExperienced", 1);
      addRolePassivePoints(state, playerId, 1, roleId, "Cultist passive", { roundNumber, eventId: result.eventId || null });
    }

    if (roleId === "chaos-agent" && eventActive) {
      incrementPlayerServerStat(state, playerId, "eventCardsExperienced", 1);
    }
  }

  return state;
}

function assignHiddenRolesToPlayers(state, shockers, { resetExisting = false } = {}) {
  state.hiddenRoles = state.hiddenRoles && typeof state.hiddenRoles === "object" ? state.hiddenRoles : {};
  let deck = getHiddenRoleDefs().slice().sort(() => Math.random() - 0.5);
  for (const s of shockers || []) {
    if (!resetExisting && state.hiddenRoles[s.id]) continue;
    if (!deck.length) deck = getHiddenRoleDefs().slice().sort(() => Math.random() - 0.5);
    const role = deck.pop();
    if (!role) {
      delete state.hiddenRoles[s.id];
      continue;
    }
    state.hiddenRoles[s.id] = {
      roleId: role.id,
      assignedAt: new Date().toISOString(),
      baseline: role.triggerType ? statValueForObjective(state.playerStats?.[s.id] || {}, { type: role.triggerType }, state) : 0,
      claims: 0
    };
  }
}

function pushObjectiveEvent(state, event) {
  state.completedObjectiveEvents = Array.isArray(state.completedObjectiveEvents) ? state.completedObjectiveEvents : [];
  const id = `${event.playerId}:${event.objectiveId}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
  const item = { id, createdAt: new Date().toISOString(), seen: false, ...event };
  state.completedObjectiveEvents.push(item);
  if (state.completedObjectiveEvents.length > 50) state.completedObjectiveEvents = state.completedObjectiveEvents.slice(-50);
  writeObjectiveEventDatabase(item);
}

function evaluateHiddenRoles(state) {
  if (!state || typeof state !== "object") return state;
  state.hiddenRoles = state.hiddenRoles && typeof state.hiddenRoles === "object" ? state.hiddenRoles : {};
  state.playerPoints = state.playerPoints && typeof state.playerPoints === "object" ? state.playerPoints : {};
  state.playerTokens = state.playerTokens && typeof state.playerTokens === "object" ? state.playerTokens : {};

  for (const [playerId, assignment] of Object.entries(state.hiddenRoles)) {
    if (!assignment || typeof assignment !== "object") continue;
    const role = hiddenRoleById(assignment.roleId);
    if (!role || !role.triggerType || role.triggerTarget <= 0) continue;
    const stats = state.playerStats?.[playerId] || {};
    const current = statValueForObjective(stats, { type: role.triggerType }, state);
    const baseline = clampInt(assignment.baseline ?? current, 0, 100000000);
    const progress = Math.max(0, current - baseline);
    const earnedClaims = role.repeatable ? Math.floor(progress / role.triggerTarget) : (progress >= role.triggerTarget ? 1 : 0);
    const previousClaims = clampInt(assignment.claims ?? 0, 0, 1000000);
    const newClaims = Math.max(0, earnedClaims - previousClaims);
    const remainderProgress = role.repeatable ? (progress % role.triggerTarget) : Math.min(progress, role.triggerTarget);
    assignment.progress = newClaims > 0 ? role.triggerTarget : remainderProgress;
    assignment.target = role.triggerTarget;
    if (newClaims > 0) {
      for (let i = 0; i < newClaims; i++) {
        if (role.rewardPoints > 0) addPlayerPoints(state, playerId, role.rewardPoints, "hidden_role_reward", { roleId: role.id });
        if (role.rewardToken && role.rewardTokenAmount > 0) addPlayerToken(state, playerId, role.rewardToken, role.rewardTokenAmount, "hidden_role_reward", { roleId: role.id });
        if (role.rewardModifier) queueRoundModifier(state, { ...role.rewardModifier, playerId, source: "hiddenRole", roleId: role.id });
        pushObjectiveEvent(state, {
          playerId,
          objectiveId: `hidden-role:${role.id}`,
          title: `Hidden role: ${role.title}`,
          rewardPoints: role.rewardPoints,
          rewardToken: role.rewardToken || null,
          rewardTokenAmount: role.rewardTokenAmount || 0,
          rewardDescription: role.rewardDescription || ""
        });
      }
      assignment.claims = previousClaims + newClaims;
      if (!role.repeatable) assignment.completed = true;
    }
  }
  return state;
}

function evaluateObjectives(state) {
  if (!state || typeof state !== "object") return state;
  const assignments = state.objectiveAssignments && typeof state.objectiveAssignments === "object" ? state.objectiveAssignments : {};
  state.playerPoints = state.playerPoints && typeof state.playerPoints === "object" ? state.playerPoints : {};

  for (const [playerId, assignmentList] of Object.entries(assignments)) {
    const list = Array.isArray(assignmentList) ? assignmentList : [assignmentList].filter(Boolean);
    const stats = state.playerStats?.[playerId] || {};
    const defs = readObjectives().objectives;
    const usedIds = new Set(list.map(a => String(a.objectiveId || a.id || "")).filter(Boolean));
    assignments[playerId] = list.map(a => {
      const def = objectiveById(a.objectiveId || a.id);
      if (!def) return a;
      const withBaseline = { ...a, baseline: a.baseline ?? objectiveBaselineValue(stats, def, state) };
      const progress = Math.min(def.target, objectiveProgressValue(stats, def, state, withBaseline));
      const wasCompleted = Boolean(a.completed);
      const completed = progress >= def.target;
      if (completed && !wasCompleted && a.rewardClaimed !== true) {
        const rewardPoints = clampInt(def.rewardPoints ?? 0, 0, 999);
        addPlayerPoints(state, playerId, rewardPoints, "objective_reward", { objectiveId: def.id });
        pushObjectiveEvent(state, { playerId, objectiveId: def.id, title: def.title, rewardPoints });

        // Completed objectives are immediately replaced so players always have something to work toward.
        const replacementPool = defs.filter(candidate => candidate.id !== def.id && !usedIds.has(candidate.id));
        const replacement = replacementPool.length ? replacementPool[Math.floor(Math.random() * replacementPool.length)] : null;
        if (replacement) {
          usedIds.delete(def.id);
          usedIds.add(replacement.id);
          return makeObjectiveAssignment(replacement, stats, state);
        }
      }
      return {
        objectiveId: def.id,
        assignedAt: a.assignedAt || new Date().toISOString(),
        baseline: withBaseline.baseline,
        progress,
        target: def.target,
        completed,
        rewardClaimed: Boolean(a.rewardClaimed ?? completed)
      };
    });
  }
  state.objectiveAssignments = assignments;
  return state;
}

const qrDataUrlCache = new Map();

async function cachedQrDataUrl(value, options = { margin: 1, width: 220 }) {
  const key = `${value}|${options.margin}|${options.width}`;
  if (qrDataUrlCache.has(key)) return qrDataUrlCache.get(key);
  const dataUrl = await QRCode.toDataURL(value, options);
  qrDataUrlCache.set(key, dataUrl);
  // Keep cache bounded across game/key changes.
  if (qrDataUrlCache.size > 200) {
    const firstKey = qrDataUrlCache.keys().next().value;
    qrDataUrlCache.delete(firstKey);
  }
  return dataUrl;
}

async function buildPlayerLinks(req) {
  const pages = playerPagesConfig();
  const { shockers } = await getShockers();
  const base = getPublicBaseUrl(req);
  const links = [];
  for (const s of shockers) {
    const playerKey = getPlayerAccessKey(s.id);
    const url = `${base}/player/${encodeURIComponent(s.id)}?key=${encodeURIComponent(playerKey)}`;
    links.push({
      playerId: s.id,
      name: s.name,
      url,
      qrDataUrl: pages.qrCodesEnabled ? await cachedQrDataUrl(url) : null
    });
  }
  return { enabled: pages.enabled, qrCodesEnabled: pages.qrCodesEnabled, publicBaseUrl: base, links };
}

function getPlayerState(playerId) {
  const state = readSessionState();
  const stats = state.playerStats?.[playerId] || {
    selected: 0, shocked: 0, vibes: 0, safe: 0, allTargeted: 0, totalIntensity: 0,
    tokensBought: 0, tokensOwned: 0, highPlusSurvived: 0, eventCardsExperienced: 0, sabotageEffects: 0, redirectedHits: 0,
    lastSelectedRound: 0, lastShockedRound: 0, lastVibeRound: 0
  };
  const assignments = Array.isArray(state.objectiveAssignments?.[playerId]) ? state.objectiveAssignments[playerId] : [];
  const objectives = assignments.map(a => {
    const def = objectiveById(a.objectiveId);
    if (!def) return null;
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      type: def.type,
      progress: clampInt(a.progress ?? 0, 0, 1000000),
      target: def.target,
      completed: Boolean(a.completed),
      reward: def.reward,
      rewardPoints: def.rewardPoints
    };
  }).filter(Boolean);
  const roleAssignment = state.hiddenRoles?.[playerId] || null;
  const roleDef = hiddenRoleById(roleAssignment?.roleId);
  let hiddenRole = null;
  if (roleDef && roleAssignment) {
    const roleCurrent = statValueForObjective(stats, { type: roleDef.triggerType }, state);
    const roleBaseline = clampInt(roleAssignment.baseline ?? 0, 0, 100000000);
    const roleTarget = clampInt(roleAssignment.target ?? roleDef.triggerTarget ?? 0, 0, 1000000);
    const roleClaims = clampInt(roleAssignment.claims ?? 0, 0, 1000000);
    const rawProgress = Math.max(0, roleCurrent - roleBaseline);
    const earnedClaims = roleTarget > 0 ? Math.floor(rawProgress / roleTarget) : 0;
    const visibleProgress = roleTarget > 0
      ? (earnedClaims > roleClaims ? roleTarget : (rawProgress % roleTarget))
      : rawProgress;
    hiddenRole = {
      ...roleDef,
      assignedAt: roleAssignment.assignedAt,
      progress: clampInt(visibleProgress, 0, 1000000),
      target: roleTarget,
      claims: roleClaims,
      currentValue: roleCurrent,
      baseline: roleBaseline
    };
  }
  return {
    roundNumber: state.roundNumber,
    updatedAt: state.updatedAt,
    stats,
    points: clampInt(state.playerPoints?.[playerId] ?? 0, 0, 1000000),
    tokens: state.playerTokens?.[playerId] || {},
    multiplier: clampInt(state.playerMultipliers?.[playerId] ?? 100, 0, 100),
    hiddenRole,
    objectives
  };
}

async function assignObjectivesToPlayers({ resetExisting = false } = {}) {
  const defs = readObjectives().objectives;
  const { shockers } = await getShockers();
  const state = readSessionState();
  assignHiddenRolesToPlayers(state, shockers, { resetExisting });
  state.objectiveAssignments = state.objectiveAssignments || {};
  const count = readObjectives().assignmentsPerPlayer || 1;
  for (const s of shockers) {
    if (!resetExisting && Array.isArray(state.objectiveAssignments[s.id]) && state.objectiveAssignments[s.id].length) continue;
    const shuffled = defs.slice().sort(() => Math.random() - 0.5).slice(0, count);
    const stats = state.playerStats?.[s.id] || {};
    state.objectiveAssignments[s.id] = shuffled.map(def => makeObjectiveAssignment(def, stats, state));
    if (state.playerPoints[s.id] === undefined) state.playerPoints[s.id] = 0;
  }
  return writeSessionState(state);
}

function requirePlayerPagesEnabled(req, res) {
  if (!playerPagesConfig().enabled) {
    sendJson(res, 403, { error: "Player pages are disabled in game settings" });
    return false;
  }
  return true;
}

function validatePlayerAccess(req, playerId, url) {
  const key = url.searchParams.get("key") || req.headers["x-player-key"] || "";
  return String(key) === getPlayerAccessKey(playerId);
}

function hostPageConfig() {
  CONFIG = readConfig();
  const cfg = CONFIG.hostPage || {};
  const page = pageEnabledFromConfig(cfg, true);
  return {
    enabled: page.enabled,
    qrCodesEnabled: page.qrCodesEnabled,
    autoRefreshMs: clampInt(cfg.autoRefreshMs ?? 1500, 500, 30000),
    allowManualControl: Boolean(cfg.allowManualControl ?? true)
  };
}

function audiencePageConfig() {
  CONFIG = readConfig();
  const cfg = CONFIG.audiencePage || {};
  const page = pageEnabledFromConfig(cfg, true);
  return {
    enabled: page.enabled,
    qrCodesEnabled: page.qrCodesEnabled,
    autoRefreshMs: clampInt(cfg.autoRefreshMs ?? 2500, 500, 30000),
    requireUniqueSession: Boolean(cfg.requireUniqueSession ?? true)
  };
}

function getRoleAccessKey(role) {
  const state = readSessionState();
  state.roleAccessKeys = state.roleAccessKeys && typeof state.roleAccessKeys === "object" ? state.roleAccessKeys : {};
  if (!state.roleAccessKeys[role]) {
    state.roleAccessKeys[role] = makeAccessCode(role);
    writeSessionState(state);
  }
  return String(state.roleAccessKeys[role]);
}

function getPlayerAccessKey(playerId) {
  const pages = playerPagesConfig();
  if (pages.useShockerIdAsAccessKey) return String(playerId);

  const state = readSessionState();
  state.roleAccessKeys = state.roleAccessKeys && typeof state.roleAccessKeys === "object" ? state.roleAccessKeys : {};
  state.roleAccessKeys.playerKeys = state.roleAccessKeys.playerKeys && typeof state.roleAccessKeys.playerKeys === "object" ? state.roleAccessKeys.playerKeys : {};

  const id = String(playerId || "");
  if (!state.roleAccessKeys.playerKeys[id]) {
    state.roleAccessKeys.playerKeys[id] = makeAccessCode("player");
    writeSessionState(state);
  }
  return String(state.roleAccessKeys.playerKeys[id]);
}

function validateRoleAccess(role, req, url) {
  const key = url.searchParams.get("key") || req.headers[`x-${role}-key`] || "";
  return String(key) === getRoleAccessKey(role);
}

function getAudienceSessionId(req, url, body = {}) {
  return String(body.audienceSessionId || body.sessionId || url.searchParams.get("audienceSessionId") || req.headers["x-audience-session-id"] || "").trim();
}

function sanitizeAudienceName(name) {
  const cleaned = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return cleaned || null;
}

function createAudienceSession(state, displayName = null) {
  state.audienceSessions = state.audienceSessions && typeof state.audienceSessions === "object" ? state.audienceSessions : {};
  const id = uuid("aud");
  const name = sanitizeAudienceName(displayName) || `Audience ${Object.keys(state.audienceSessions).length + 1}`;
  state.audienceSessions[id] = {
    id,
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    lastActionAt: null,
    lastActionRound: null,
    votesThisRound: 0,
    totalVotes: 0,
    displayName: name
  };
  appendAudienceEvent(state, { type: "audienceJoined", audienceSessionId: id, audienceName: name });
  return state.audienceSessions[id];
}

function updateAudienceSessionName(state, session, displayName) {
  const name = sanitizeAudienceName(displayName);
  if (!session || !name || session.displayName === name) return session;
  const oldName = session.displayName;
  session.displayName = name;
  session.lastSeenAt = new Date().toISOString();
  appendAudienceEvent(state, { type: "audienceRenamed", audienceSessionId: session.id, audienceName: name, oldName });
  return session;
}

function appendAudienceEvent(state, event) {
  state.audienceEventLog = Array.isArray(state.audienceEventLog) ? state.audienceEventLog : [];
  const item = { id: uuid("audlog"), at: new Date().toISOString(), ...event };
  state.audienceEventLog.push(item);
  state.audienceEventLog = state.audienceEventLog.slice(-250);
  writeDatabaseEvent({
    state,
    type: item.type || "audience",
    title: item.title || String(item.type || "Audience event"),
    description: item.description || item.audienceName || item.oldName || null,
    actorPlayerId: item.playerId || null,
    targetPlayerId: item.targetPlayerId || null,
    metadata: item
  });
}

function ensureAudienceSession(state, sessionId) {
  state.audienceSessions = state.audienceSessions && typeof state.audienceSessions === "object" ? state.audienceSessions : {};
  if (!sessionId || !state.audienceSessions[sessionId]) return null;
  return state.audienceSessions[sessionId];
}

function ensureOrCreateAudienceSession(state, sessionId, displayName = null) {
  const session = ensureAudienceSession(state, sessionId) || createAudienceSession(state, displayName);
  updateAudienceSessionName(state, session, displayName);
  session.lastSeenAt = new Date().toISOString();
  return session;
}

function validateAudienceAccess(req, url) {
  // Audience identity is intentionally based on the generated audience session id,
  // not on a shared access key. This keeps the public audience QR easy to use
  // while still letting us rate-limit every audience member separately.
  return audiencePageConfig().enabled;
}

function checkAudienceRateLimit(state, session) {
  const economy = economyConfig();
  const now = Date.now();
  const currentRound = clampInt(state.roundNumber ?? 0, 0, 1000000);
  if (session.lastActionRound !== currentRound) {
    session.lastActionRound = currentRound;
    session.votesThisRound = 0;
  }
  const cooldownMs = economy.audienceCooldownSeconds * 1000;
  if (cooldownMs > 0 && session.lastActionAt) {
    const diff = now - Date.parse(session.lastActionAt);
    if (diff < cooldownMs) {
      const remainingSeconds = Math.ceil((cooldownMs - diff) / 1000);
      return { ok: false, error: `Audience cooldown active. Try again in ${remainingSeconds}s.`, remainingSeconds };
    }
  }
  if (session.votesThisRound >= economy.audienceMaxVotesPerRound) {
    return { ok: false, error: `Audience vote limit reached for round ${currentRound}.`, remainingSeconds: 0 };
  }
  return { ok: true };
}

function recordAudienceAction(session) {
  session.lastActionAt = new Date().toISOString();
  session.votesThisRound = clampInt(session.votesThisRound ?? 0, 0, 1000000) + 1;
  session.totalVotes = clampInt(session.totalVotes ?? 0, 0, 1000000) + 1;
}

async function buildRoleLinks(req) {
  const base = getPublicBaseUrl(req);
  const host = hostPageConfig();
  const audience = audiencePageConfig();
  const hostUrl = `${base}/host?key=${encodeURIComponent(getRoleAccessKey("host"))}`;
  const audienceUrl = `${base}/audience?key=${encodeURIComponent(getRoleAccessKey("audience"))}`;
  return {
    publicBaseUrl: base,
    host: {
      enabled: host.enabled,
      qrCodesEnabled: host.qrCodesEnabled,
      url: hostUrl,
      qrDataUrl: host.enabled && host.qrCodesEnabled ? await cachedQrDataUrl(hostUrl) : null
    },
    audience: {
      enabled: audience.enabled,
      qrCodesEnabled: audience.qrCodesEnabled,
      url: audienceUrl,
      qrDataUrl: audience.enabled && audience.qrCodesEnabled ? await cachedQrDataUrl(audienceUrl) : null
    }
  };
}

function uuid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function spendPlayerPoints(state, playerId, amount, reason = "spend", metadata = {}) {
  amount = clampInt(amount ?? 0, 0, 999999);
  state.playerPoints = state.playerPoints || {};
  const current = clampInt(state.playerPoints[playerId] ?? 0, 0, 1000000);
  if (current < amount) return false;
  state.playerPoints[playerId] = current - amount;
  writePointLedger(state, playerId, -amount, reason, metadata);
  upsertPointBalanceDatabase(playerId, state.playerPoints[playerId]);
  return true;
}

function addPlayerPoints(state, playerId, amount, reason = "award", metadata = {}) {
  amount = clampInt(amount ?? 0, 0, 999999);
  state.playerPoints = state.playerPoints || {};
  state.playerPoints[playerId] = clampInt(state.playerPoints[playerId] ?? 0, 0, 1000000) + amount;
  writePointLedger(state, playerId, amount, reason, metadata);
  upsertPointBalanceDatabase(playerId, state.playerPoints[playerId]);
}

function incrementPlayerServerStat(state, playerId, statName, amount = 1) {
  if (!playerId || !statName) return;
  state.playerStats = state.playerStats && typeof state.playerStats === "object" ? state.playerStats : {};
  const current = state.playerStats[playerId] && typeof state.playerStats[playerId] === "object" ? state.playerStats[playerId] : {};
  state.playerStats[playerId] = {
    selected: clampInt(current.selected ?? 0, 0, 1000000),
    shocked: clampInt(current.shocked ?? 0, 0, 1000000),
    vibes: clampInt(current.vibes ?? 0, 0, 1000000),
    safe: clampInt(current.safe ?? 0, 0, 1000000),
    allTargeted: clampInt(current.allTargeted ?? 0, 0, 1000000),
    totalIntensity: clampInt(current.totalIntensity ?? 0, 0, 100000000),
    bodyguards: clampInt(current.bodyguards ?? 0, 0, 1000000),
    cursesUsed: clampInt(current.cursesUsed ?? 0, 0, 1000000),
    chaosUsed: clampInt(current.chaosUsed ?? 0, 0, 1000000),
    tokensBought: clampInt(current.tokensBought ?? 0, 0, 1000000),
    lastSelectedRound: clampInt(current.lastSelectedRound ?? 0, 0, 1000000),
    lastShockedRound: clampInt(current.lastShockedRound ?? 0, 0, 1000000),
    lastVibeRound: clampInt(current.lastVibeRound ?? 0, 0, 1000000)
  };
  state.playerStats[playerId][statName] = clampInt(state.playerStats[playerId][statName] ?? 0, 0, 1000000) + clampInt(amount, 1, 999);
  upsertPlayerStatsDatabase(playerId, state.playerStats[playerId]);
}

function ensurePlayerTokenBucket(state, playerId) {
  state.playerTokens = state.playerTokens && typeof state.playerTokens === "object" ? state.playerTokens : {};
  state.playerTokens[playerId] = state.playerTokens[playerId] && typeof state.playerTokens[playerId] === "object" ? state.playerTokens[playerId] : {};
  return state.playerTokens[playerId];
}

function addPlayerToken(state, playerId, tokenType, amount = 1, reason = "award", metadata = {}) {
  tokenType = normalizeTokenType(tokenType);
  if (!tokenType) throw new Error("Invalid token type");
  const bucket = ensurePlayerTokenBucket(state, playerId);
  const delta = clampInt(amount, 1, 999);
  bucket[tokenType] = clampInt(bucket[tokenType] ?? 0, 0, 1000000) + delta;
  writeTokenLedger(state, playerId, tokenType, delta, reason, metadata);
  upsertTokenBalanceDatabase(playerId, tokenType, bucket[tokenType]);
}

function spendPlayerToken(state, playerId, tokenType, amount = 1, reason = "spend", metadata = {}) {
  tokenType = normalizeTokenType(tokenType);
  if (!tokenType) return false;
  const bucket = ensurePlayerTokenBucket(state, playerId);
  const current = clampInt(bucket[tokenType] ?? 0, 0, 1000000);
  amount = clampInt(amount, 1, 999);
  if (current < amount) return false;
  bucket[tokenType] = current - amount;
  writeTokenLedger(state, playerId, tokenType, -amount, reason, metadata);
  upsertTokenBalanceDatabase(playerId, tokenType, bucket[tokenType]);
  return true;
}

function buyPlayerToken(state, playerId, tokenType) {
  tokenType = normalizeTokenType(tokenType);
  if (!tokenType) throw new Error("Invalid token type");
  const baseCost = clampInt(economyConfig().tokenCosts[tokenType] ?? 0, 0, 999);
  const isMerchant = playerHasRole(state, playerId, "merchant");
  const cost = isMerchant ? Math.max(1, baseCost - 1) : baseCost;
  if (!spendPlayerPoints(state, playerId, cost, "token_purchase", { tokenType, baseCost, merchantDiscount: isMerchant ? 1 : 0 })) throw new Error(`${tokenType} token costs ${cost} points`);
  addPlayerToken(state, playerId, tokenType, 1, "token_purchase", { cost, baseCost, merchantDiscount: isMerchant ? 1 : 0 });
  writePurchaseLog(state, playerId, "token", tokenType, cost, { tokenType, baseCost, merchantDiscount: isMerchant ? 1 : 0 });

  // Merchant / token-shop progress must be tied to the actual purchase action.
  // This still counts when the points came from bribes, audience rewards, or host rewards,
  // because the relevant game action is spending those points in the shop.
  incrementPlayerServerStat(state, playerId, "tokensBought", 1);
  state.playerStats[playerId].tokensOwned = Math.max(clampInt(state.playerStats[playerId].tokensOwned ?? 0, 0, 1000000), totalOwnedTokens(state, playerId));

  return { tokenType, cost, baseCost, merchantDiscount: isMerchant ? 1 : 0 };
}

function queueRoundModifier(state, modifier) {
  state.pendingRoundModifiers = Array.isArray(state.pendingRoundModifiers) ? state.pendingRoundModifiers : [];
  const item = {
    id: modifier.id || uuid("mod"),
    status: "active",
    scope: modifier.scope || "nextRound",
    createdAt: new Date().toISOString(),
    ...modifier
  };
  state.pendingRoundModifiers.push(item);
  writeDatabaseEvent({ state, type: "roundModifierQueued", title: `Queued ${item.type || "modifier"}`, description: item.description || item.reason || null, actorPlayerId: item.playerId || item.bodyguardPlayerId || null, targetPlayerId: item.targetPlayerId || null, metadata: item });
  return item;
}

function queuePlayerAction(state, action) {
  state.pendingPlayerActions = Array.isArray(state.pendingPlayerActions) ? state.pendingPlayerActions : [];
  const item = {
    id: action.id || uuid("act"),
    status: "pending",
    createdAt: new Date().toISOString(),
    ...action
  };
  state.pendingPlayerActions.push(item);
  writeDatabaseEvent({ state, type: "playerActionQueued", title: `Queued ${item.type || "action"}`, actorPlayerId: item.playerId || item.bodyguardPlayerId || null, targetPlayerId: item.targetPlayerId || null, metadata: item });
  return item;
}

async function publicPlayers(existingShockers = null, existingState = null) {
  const shockers = existingShockers || (await getShockers()).shockers;
  try {
    syncKnownDevicesToDatabase(shockers, existingState || readSessionState());
  } catch (err) {
    console.warn(`WARNING: Could not update structured player/device tables: ${err.message}`);
  }
  return shockers.map(s => ({ id: s.id, name: s.name }));
}

function playerNameById(shockers = [], id, fallback = null) {
  if (!id) return fallback;
  const found = shockers.find(s => String(s.id) === String(id));
  return found?.name || fallback || "Unknown player";
}

function pendingActionView(action, shockers = []) {
  return {
    ...action,
    playerName: playerNameById(shockers, action.playerId, action.source === "audience" ? "Audience" : "Player"),
    targetName: playerNameById(shockers, action.targetPlayerId, null),
    bodyguardName: playerNameById(shockers, action.bodyguardPlayerId, null)
  };
}


function modifierView(mod, shockers = []) {
  return {
    ...mod,
    playerName: playerNameById(shockers, mod.playerId, null),
    targetName: playerNameById(shockers, mod.targetPlayerId, null),
    bodyguardName: playerNameById(shockers, mod.bodyguardPlayerId, null)
  };
}

function voteView(vote, shockers = [], state = null) {
  const ids = Array.isArray(vote.audienceSessionIds) ? vote.audienceSessionIds : [];
  const sessions = state?.audienceSessions && typeof state.audienceSessions === "object" ? state.audienceSessions : {};
  return {
    ...vote,
    targetName: playerNameById(shockers, vote.targetPlayerId, null),
    audienceCount: ids.length || (vote.count || 0),
    audienceNames: ids.map(id => sessions[id]?.displayName || id)
  };
}

function getAudienceSessionCount(state) {
  const sessions = state?.audienceSessions && typeof state.audienceSessions === "object" ? Object.values(state.audienceSessions) : [];
  const now = Date.now();
  const activeWindowMs = clampInt(audiencePageConfig().activeAudienceWindowSeconds ?? 600, 30, 86400) * 1000;
  const active = sessions.filter(s => {
    const stamp = Date.parse(s.lastSeenAt || s.lastActionAt || s.joinedAt || "");
    return Number.isFinite(stamp) && now - stamp <= activeWindowMs;
  });
  return active.length;
}

function effectiveAudienceVoteThreshold(state) {
  const configured = clampInt(economyConfig().audienceVoteThreshold ?? 1, 1, 1000000);
  const audienceCount = getAudienceSessionCount(state);
  return Math.max(1, Math.min(configured, Math.max(1, audienceCount)));
}

function buildSessionStats(state, players = []) {
  return players.map(p => ({
    id: p.id,
    name: p.name,
    points: clampInt(state.playerPoints?.[p.id] ?? 0, 0, 1000000),
    tokens: state.playerTokens?.[p.id] || {},
    stats: state.playerStats?.[p.id] || {}
  })).sort((a, b) => (b.stats.shocked || 0) - (a.stats.shocked || 0));
}

async function getHostState() {
  const state = readSessionState();
  const { shockers } = await getShockers();
  const players = await publicPlayers(shockers, state);
  return {
    roundNumber: state.roundNumber,
    updatedAt: state.updatedAt,
    players,
    economy: economyConfig(),
    hostPage: hostPageConfig(),
    audiencePage: audiencePageConfig(),
    audienceVoteThresholdEffective: effectiveAudienceVoteThreshold(state),
    audienceSessions: Object.values(state.audienceSessions || {}),
    audienceEventLog: state.audienceEventLog || [],
    hostPaused: Boolean(state.hostPaused),
    completedObjectiveEvents: state.completedObjectiveEvents || [],
    sessionStats: buildSessionStats(state, players),
    playerMultipliers: state.playerMultipliers || {},
    pendingRoundModifiers: (state.pendingRoundModifiers || []).map(m => modifierView(m, shockers)),
    audienceVotes: (state.audienceVotes || []).map(v => voteView(v, shockers, state)),
    pendingPlayerActions: (state.pendingPlayerActions || []).map(a => pendingActionView(a, shockers)).filter(a => a.status === "pending")
  };
}

function createModifierFromAction(action, state) {
  const economy = economyConfig();
  if (action.type === "bodyguardOffer") {
    incrementPlayerServerStat(state, action.bodyguardPlayerId, "bodyguards", 1);
    incrementPlayerServerStat(state, action.bodyguardPlayerId, "redirectedHits", 1);
    addPlayerPoints(state, action.bodyguardPlayerId, economy.bodyguardRewardPoints, "bodyguard_reward", { targetPlayerId: action.targetPlayerId, actionId: action.id });
    if (playerHasRole(state, action.bodyguardPlayerId, "bodyguard")) {
      addRolePassivePoints(state, action.bodyguardPlayerId, 1, "bodyguard", "Bodyguard passive", { targetPlayerId: action.targetPlayerId, actionId: action.id });
    }
    if (playerHasRole(state, action.bodyguardPlayerId, "martyr")) {
      addRolePassivePoints(state, action.bodyguardPlayerId, 2, "martyr", "Martyr passive", { targetPlayerId: action.targetPlayerId, actionId: action.id });
    }
    return queueRoundModifier(state, {
      type: "bodyguardNextRound",
      bodyguardPlayerId: action.bodyguardPlayerId,
      targetPlayerId: action.targetPlayerId,
      rewardPoints: economy.bodyguardRewardPoints,
      sourceActionId: action.id
    });
  }
  if (action.type === "blessPlayer") {
    if (action.payment === "token") {
      if (action.playerId && !spendPlayerToken(state, action.playerId, "blessing", 1)) throw new Error("No blessing token available");
    } else if (action.playerId && !spendPlayerPoints(state, action.playerId, economy.blessingCost)) throw new Error("Not enough points for blessing");
    return queueRoundModifier(state, {
      type: action.effectType || "blessingNextRound",
      playerId: action.playerId || null,
      targetPlayerId: action.targetPlayerId,
      valueOffset: action.effectType === "luckyBlessing" ? 0 : -10,
      targetWeightMultiplier: action.effectType === "luckyBlessing" ? 0.5 : 1,
      capFateMax: "medium",
      sourceActionId: action.id
    });
  }
  if (action.type === "cursePlayer") {
    incrementPlayerServerStat(state, action.playerId, "cursesUsed", 1);
    if (action.payment === "token") {
      if (action.playerId && !spendPlayerToken(state, action.playerId, "curse", 1)) throw new Error("No curse token available");
    } else if (action.playerId && !spendPlayerPoints(state, action.playerId, economy.curseCost)) throw new Error("Not enough points for curse");
    return queueRoundModifier(state, {
      type: action.effectType || "curseNextRound",
      playerId: action.playerId || null,
      targetPlayerId: action.targetPlayerId,
      valueOffset: action.effectType === "markedCurse" ? 0 : 10,
      targetWeightMultiplier: action.effectType === "markedCurse" ? 2 : 1,
      sourceActionId: action.id
    });
  }
  if (action.type === "guaranteedPick") {
    return queueRoundModifier(state, {
      type: "guaranteedPickNextRound",
      playerId: action.playerId || null,
      targetPlayerId: action.targetPlayerId,
      tokenType: "guarantee",
      sourceActionId: action.id
    });
  }
  if (action.type === "giveToken") {
    addPlayerToken(state, action.targetPlayerId, action.tokenType || "shield", action.amount || economy.audienceTokenGrantAmount || 1);
    return null;
  }
  throw new Error(`Unsupported action type: ${action.type}`);
}

async function handlePlayerAction(req, res, playerId, url) {
  if (!validatePlayerAccess(req, playerId, url)) return sendJson(res, 403, { error: "Invalid player key" });
  const body = await readBody(req);
  const state = readSessionState();
  const economy = economyConfig();
  const type = String(body.type || "");
  let result = null;

  if (type === "buyToken") {
    try { result = buyPlayerToken(state, playerId, body.tokenType); }
    catch (err) { return sendJson(res, 400, { error: err.message }); }
  } else if (type === "useShieldToken" || type === "shieldNextRound") {
    if (!spendPlayerToken(state, playerId, "shield", 1)) return sendJson(res, 400, { error: "No shield token available" });
    result = queueRoundModifier(state, { type: "shieldNextRound", playerId, targetPlayerId: playerId, tokenType: "shield" });
  } else if (type === "useMercyToken" || type === "mercyNextRound") {
    if (!spendPlayerToken(state, playerId, "mercy", 1)) return sendJson(res, 400, { error: "No mercy token available" });
    result = queueRoundModifier(state, { type: "mercyNextRound", playerId, targetPlayerId: playerId, capFateMax: "medium", tokenType: "mercy" });
  } else if (type === "useChaosToken") {
    if (!spendPlayerToken(state, playerId, "chaos", 1)) return sendJson(res, 400, { error: "No chaos token available" });
    incrementPlayerServerStat(state, playerId, "chaosUsed", 1);
    result = queueRoundModifier(state, { type: "chaosNextRound", playerId, targetPlayerId: playerId, tokenType: "chaos" });
  } else if (type === "useImmunityToken" || type === "immunityNextRound") {
    if (!spendPlayerToken(state, playerId, "immunity", 1)) return sendJson(res, 400, { error: "No immunity token available" });
    result = queueRoundModifier(state, { type: "immunityNextRound", playerId, targetPlayerId: playerId, tokenType: "immunity", description: "Ignore the next hit that would target this player." });
  } else if (type === "useDoubleShockToken" || type === "doubleShockNextRound") {
    const targetPlayerId = String(body.targetPlayerId || "");
    if (!targetPlayerId) return sendJson(res, 400, { error: "Pick a target player" });
    if (!spendPlayerToken(state, playerId, "doubleShock", 1)) return sendJson(res, 400, { error: "No doubleShock token available" });
    result = queueRoundModifier(state, { type: "forcedDoubleShockNextRound", playerId, targetPlayerId, tokenType: "doubleShock", description: "Force a second activation when this player is hit next round." });
  } else if (type === "guaranteedPick") {
    const targetPlayerId = String(body.targetPlayerId || "");
    if (!targetPlayerId) return sendJson(res, 400, { error: "Pick a target player" });
    if (!spendPlayerToken(state, playerId, "guarantee", 1)) return sendJson(res, 400, { error: "No guarantee token available" });
    result = queueRoundModifier(state, { type: "guaranteedPickNextRound", playerId, targetPlayerId, tokenType: "guarantee" });
  } else if (type === "bodyguardOffer") {
    const targetPlayerId = String(body.targetPlayerId || "");
    if (!targetPlayerId || targetPlayerId === playerId) return sendJson(res, 400, { error: "Pick another player to bodyguard" });
    result = queuePlayerAction(state, { type, playerId, bodyguardPlayerId: playerId, targetPlayerId });
  } else if (type === "blessPlayer" || type === "cursePlayer") {
    const targetPlayerId = String(body.targetPlayerId || "");
    if (!targetPlayerId) return sendJson(res, 400, { error: "Pick a target player" });
    const payment = body.payment === "token" ? "token" : "points";
    result = queuePlayerAction(state, { type, playerId, targetPlayerId, payment, tokenType: type === "blessPlayer" ? "blessing" : "curse" });
  } else {
    return sendJson(res, 400, { error: "Unsupported player action" });
  }

  if (["cursePlayer", "useDoubleShockToken", "doubleShockNextRound", "guaranteedPick"].includes(type) && result?.targetPlayerId && String(result.targetPlayerId) !== String(playerId)) {
    incrementPlayerServerStat(state, playerId, "sabotageEffects", 1);
    if (playerHasRole(state, playerId, "saboteur")) {
      addRolePassivePoints(state, playerId, 1, "saboteur", "Saboteur passive", { actionType: type, targetPlayerId: result.targetPlayerId });
    }
  }

  writeSessionState(state);
  return sendJson(res, 200, { queued: true, action: result, state: getPlayerState(playerId) });
}


function sameAudienceVote(a, b) {
  return a.type === b.type && String(a.targetPlayerId || "") === String(b.targetPlayerId || "") && String(a.tokenType || "") === String(b.tokenType || "");
}

function addAudienceVote(state, vote) {
  state.audienceVotes = Array.isArray(state.audienceVotes) ? state.audienceVotes : [];
  const audienceSessionId = String(vote.audienceSessionId || "");
  const existing = state.audienceVotes.find(v => v.status === "open" && sameAudienceVote(v, vote));
  if (existing) {
    existing.audienceSessionIds = Array.isArray(existing.audienceSessionIds) ? existing.audienceSessionIds : [];
    if (audienceSessionId && existing.audienceSessionIds.includes(audienceSessionId)) {
      throw new Error("You already voted for this option.");
    }
    if (audienceSessionId) existing.audienceSessionIds.push(audienceSessionId);
    existing.count = clampInt(existing.audienceSessionIds.length || existing.count || 0, 0, 1000000);
    existing.updatedAt = new Date().toISOString();
    appendAudienceEvent(state, { type: "audienceVote", audienceSessionId, audienceName: state.audienceSessions?.[audienceSessionId]?.displayName || audienceSessionId, voteId: existing.id, actionType: existing.type, targetPlayerId: existing.targetPlayerId, tokenType: existing.tokenType || null });
    return existing;
  }
  const item = {
    id: uuid("vote"),
    status: "open",
    count: 1,
    createdAt: new Date().toISOString(),
    ...vote,
    audienceSessionIds: audienceSessionId ? [audienceSessionId] : []
  };
  state.audienceVotes.push(item);
  appendAudienceEvent(state, { type: "audienceVote", audienceSessionId, audienceName: state.audienceSessions?.[audienceSessionId]?.displayName || audienceSessionId, voteId: item.id, actionType: item.type, targetPlayerId: item.targetPlayerId, tokenType: item.tokenType || null });
  return item;
}

function convertVoteToAction(state, vote) {
  if (!vote || vote.status !== "open") throw new Error("Vote is not open");
  vote.status = "approved";
  vote.resolvedAt = new Date().toISOString();
  if (vote.type === "guaranteedPick") {
    return queueRoundModifier(state, { type: "guaranteedPickNextRound", source: "audience", targetPlayerId: vote.targetPlayerId, tokenType: "guarantee", sourceVoteId: vote.id });
  }
  return queuePlayerAction(state, { type: vote.type, source: "audience", targetPlayerId: vote.targetPlayerId, tokenType: vote.tokenType, amount: economyConfig().audienceTokenGrantAmount });
}

async function handleAudienceAction(req, res, url) {
  if (!validateAudienceAccess(req, url)) return sendJson(res, 403, { error: "Audience page is disabled" });
  const body = await readBody(req);
  const state = readSessionState();
  const sessionId = getAudienceSessionId(req, url, body);
  const uniqueAudience = audiencePageConfig().requireUniqueSession;
  const displayName = sanitizeAudienceName(body.displayName || body.audienceName || "");
  const session = uniqueAudience ? ensureOrCreateAudienceSession(state, sessionId, displayName) : { id: sessionId || "shared", displayName: displayName || "Audience" };
  const limit = checkAudienceRateLimit(state, session);
  if (!limit.ok) return sendJson(res, 429, { error: limit.error, remainingSeconds: limit.remainingSeconds });

  const type = String(body.type || "");
  const targetPlayerId = String(body.targetPlayerId || "");
  if (!["blessPlayer", "cursePlayer", "giveToken", "guaranteedPick"].includes(type)) return sendJson(res, 400, { error: "Unsupported audience action" });
  if (!targetPlayerId) return sendJson(res, 400, { error: "Pick a target player" });
  const tokenType = type === "giveToken" ? normalizeTokenType(body.tokenType || "shield") : (type === "guaranteedPick" ? "guarantee" : null);
  if (type === "giveToken" && !tokenType) return sendJson(res, 400, { error: "Pick a valid token type" });

  let vote;
  try {
    vote = addAudienceVote(state, { type, source: "audience", targetPlayerId, tokenType, amount: economyConfig().audienceTokenGrantAmount, audienceSessionId: session.id });
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  // Audience actions are suggestions/votes only. Even when the vote threshold is reached,
  // the host must explicitly approve or reject the action. Player token actions remain
  // immediate next-round modifiers because those spend the player's own token.
  recordAudienceAction(session);
  writeSessionState(state);
  return sendJson(res, 200, { voted: true, vote, session, autoApproved: false, modifier: null });
}

async function createOrReadAudienceSession(req, res, url) {
  if (!validateAudienceAccess(req, url)) return sendJson(res, 403, { error: "Audience page is disabled" });
  const body = req.method === "POST" ? await readBody(req) : {};
  const state = readSessionState();
  const requested = getAudienceSessionId(req, url, body);
  const displayName = sanitizeAudienceName(body.displayName || body.audienceName || url.searchParams.get("displayName") || "");
  let session = ensureAudienceSession(state, requested);
  if (!session) session = createAudienceSession(state, displayName);
  updateAudienceSessionName(state, session, displayName);
  session.lastSeenAt = new Date().toISOString();
  writeSessionState(state);
  return sendJson(res, 200, { session, economy: economyConfig() });
}


async function resolveAudienceVote(req, res, url) {
  if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
  const body = await readBody(req);
  const voteId = String(body.voteId || "");
  const approved = Boolean(body.approved);
  const state = readSessionState();
  const vote = (state.audienceVotes || []).find(v => v.id === voteId);
  if (!vote) return sendJson(res, 404, { error: "Vote not found" });
  if (vote.status !== "open") return sendJson(res, 400, { error: "Vote is not open" });
  let action = null;
  const voteCount = Array.isArray(vote.audienceSessionIds) ? vote.audienceSessionIds.length : clampInt(vote.count ?? 0, 0, 1000000);
  const threshold = effectiveAudienceVoteThreshold(state);
  if (approved && voteCount < threshold) {
    return sendJson(res, 400, { error: `Vote needs ${threshold} audience approval(s); currently has ${voteCount}.`, vote, threshold, voteCount });
  }
  if (approved) action = convertVoteToAction(state, vote);
  else { vote.status = "rejected"; vote.resolvedAt = new Date().toISOString(); }
  writeSessionState(state);
  return sendJson(res, 200, { resolved: true, approved, action, state: await getHostState() });
}

async function acknowledgeObjectiveEvents(req, res, url) {
  if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
  const body = await readBody(req);
  const ids = new Set((body.ids || []).map(String));
  const state = readSessionState();
  state.completedObjectiveEvents = (state.completedObjectiveEvents || []).map(e => ids.has(String(e.id)) ? { ...e, seen: true } : e);
  writeSessionState(state);
  return sendJson(res, 200, { ok: true, state: await getHostState() });
}

async function resolveHostAction(req, res, url) {
  if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
  const body = await readBody(req);
  const actionId = String(body.actionId || "");
  const approved = Boolean(body.approved);
  const state = readSessionState();
  const action = (state.pendingPlayerActions || []).find(a => a.id === actionId);
  if (!action) return sendJson(res, 404, { error: "Action not found" });
  if (action.status !== "pending") return sendJson(res, 400, { error: "Action is not pending" });
  action.status = approved ? "approved" : "rejected";
  action.resolvedAt = new Date().toISOString();
  let modifier = null;
  if (approved) modifier = createModifierFromAction(action, state);
  writeSessionState(state);
  return sendJson(res, 200, { resolved: true, approved, modifier, state: await getHostState() });
}

async function rewardPlayerFromHost(req, res, url) {
  if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
  const body = await readBody(req);
  const state = readSessionState();
  const targetPlayerId = String(body.targetPlayerId || "");
  if (!targetPlayerId) return sendJson(res, 400, { error: "Pick a target player" });
  const rewardType = String(body.rewardType || "points");
  let result;
  if (rewardType === "points") {
    const amount = clampInt(body.amount ?? economyConfig().hostDefaultPointDonation, 1, 999);
    addPlayerPoints(state, targetPlayerId, amount, "host_reward", { rewardType: "points" });
    result = { rewardType, targetPlayerId, amount };
  } else if (rewardType === "token") {
    const tokenType = normalizeTokenType(body.tokenType || "shield");
    if (!tokenType) return sendJson(res, 400, { error: "Pick a valid token type" });
    const amount = clampInt(body.amount ?? economyConfig().hostDefaultTokenDonationAmount, 1, 99);
    addPlayerToken(state, targetPlayerId, tokenType, amount);
    result = { rewardType, targetPlayerId, tokenType, amount };
  } else {
    return sendJson(res, 400, { error: "Unsupported reward type" });
  }
  writeSessionState(state);
  return sendJson(res, 200, { ok: true, reward: result, state: await getHostState() });
}

function consumeRoundModifiers(ids) {
  const state = readSessionState();
  const remove = new Set((ids || []).map(String));
  state.pendingRoundModifiers = (state.pendingRoundModifiers || []).filter(m => !remove.has(String(m.id)));
  writeSessionState(state);
  return state.pendingRoundModifiers;
}

function restoreOriginalFateWheel(fateWheel) {
  const original = [
    { key: "vibe", name: "Vibe", min: 0, max: 0, weight: 5, enabled: true, escalates: "down" },
    { key: "warmup", name: "Warmup", min: 1, max: 15, weight: 32, enabled: true, escalates: "down" },
    { key: "low", name: "Low", min: 16, max: 35, weight: 24, enabled: true, escalates: "neutral" },
    { key: "medium", name: "Medium", min: 36, max: 60, weight: 16, enabled: true, escalates: "up" },
    { key: "high", name: "High", min: 61, max: 75, weight: 8, enabled: true, escalates: "up" },
    { key: "brutal", name: "Brutal", min: 76, max: 90, weight: 3, enabled: true, escalates: "up" },
    { key: "deathwish", name: "Deathwish", min: 91, max: 99, weight: 1, enabled: true, escalates: "up" }
  ];
  const incoming = Array.isArray(fateWheel) ? fateWheel : [];
  if (!incoming.length) return original;
  const byKey = new Map();
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    let key = String(item.key || item.name || "").trim().toLowerCase();
    if (key === "light") key = "low";
    if (key) byKey.set(key, item);
  }
  const result = original.map(def => {
    const current = byKey.get(def.key) || {};
    return {
      ...def,
      ...current,
      key: def.key,
      name: def.name,
      min: current.min ?? def.min,
      max: current.max ?? def.max,
      weight: current.weight ?? def.weight,
      enabled: current.enabled ?? def.enabled,
      escalates: current.escalates ?? def.escalates
    };
  });
  return result;
}

function normalizeConfigForRuntime(input) {
  const src = input && typeof input === "object" ? input : {};
  const spinners = src.spinners || {};
  const pages = src.pages || {};
  const devices = src.devices || {};

  const runtime = { ...src };
  runtime.version = src.version || "1.3.0";
  runtime.server = { ...(src.server || {}) };
  runtime.app = { ...(src.app || {}) };
  runtime.safety = { ...(src.safety || {}) };
  runtime.keyboard = { ...(src.keyboard || {}) };
  runtime.game = { ...(src.game || {}) };
  runtime.ui = { ...(src.ui || {}) };
  runtime.economy = { ...(src.economy || {}) };
  runtime.eventCards = { ...(src.eventCards || src.events?.eventCards || {}) };

  runtime.targetWheel = { ...(src.targetWheel || spinners.targetWheel || spinners.target || {}) };
  runtime.fateWheel = Array.isArray(src.fateWheel)
    ? src.fateWheel
    : Array.isArray(spinners.fateWheel)
      ? spinners.fateWheel
      : Array.isArray(spinners.fate)
        ? spinners.fate
        : [];

  runtime.fateWheel = restoreOriginalFateWheel(runtime.fateWheel);

  runtime.playerPages = { ...(src.playerPages || pages.player || {}) };
  runtime.hostPage = { ...(src.hostPage || pages.host || {}) };
  runtime.audiencePage = { ...(src.audiencePage || pages.audience || {}) };
  runtime.shockers = { ...(src.shockers || devices.shockers || {}) };

  if (src.api?.openshock) {
    runtime.server.apiHost = runtime.server.apiHost || src.api.openshock.host;
    runtime.server.userAgent = runtime.server.userAgent || src.api.openshock.userAgent;
  }

  return runtime;
}

function configForDisk(config) {
  const runtime = validateConfig(normalizeConfigForRuntime(config));
  return {
    version: "1.3.0",
    app: runtime.app || {},
    server: runtime.server || {},
    api: {
      openshock: {
        host: runtime.server?.apiHost || "api.openshock.app",
        userAgent: runtime.server?.userAgent || "OpenShock-Roulette/1.3.0 (local-party-game)"
      }
    },
    safety: runtime.safety || {},
    keyboard: runtime.keyboard || {},
    spinners: {
      target: runtime.targetWheel || {},
      fate: runtime.fateWheel || []
    },
    game: runtime.game || {},
    events: {
      eventCards: runtime.eventCards || {}
    },
    pages: {
      player: runtime.playerPages || {},
      host: runtime.hostPage || {},
      audience: runtime.audiencePage || {}
    },
    economy: runtime.economy || {},
    ui: runtime.ui || {},
    devices: {
      shockers: runtime.shockers || {}
    }
  };
}

let configCache = null;
let configCacheMtimeMs = 0;

function invalidateConfigCache() {
  configCache = null;
  configCacheMtimeMs = 0;
}

function readConfig() {
  ensureLocalFilesFromExamples();
  const source = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
  const mtimeMs = fs.existsSync(source) ? fs.statSync(source).mtimeMs : 0;
  if (configCache && configCacheMtimeMs === mtimeMs) return configCache;
  const fallback = fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, "utf8")) : { fateWheel: restoreOriginalFateWheel([]) };
  configCache = validateConfig(normalizeConfigForRuntime(fallback));
  configCacheMtimeMs = mtimeMs;
  return configCache;
}

function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const validated = validateConfig(config);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configForDisk(validated), null, 2), "utf8");
  invalidateConfigCache();
}

function resetGameConfigToDefaults() {
  const fallback = fs.existsSync(CONFIG_EXAMPLE_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_EXAMPLE_PATH, "utf8"))
    : { fateWheel: restoreOriginalFateWheel([]) };
  const validated = validateConfig(normalizeConfigForRuntime(fallback));
  writeConfig(validated);
  invalidateConfigCache();
  return validated;
}

function readEventCards() {
  ensureLocalFilesFromExamples();
  const source = fs.existsSync(EVENT_CARDS_PATH) ? EVENT_CARDS_PATH : EVENT_CARDS_EXAMPLE_PATH;
  const raw = fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, "utf8")) : { enabled: true, chancePercent: 18, displayDurationMs: 10000, cards: [] };
  return validateEventCards(raw);
}

let CONFIG = readConfig();

const PORT = process.env.PORT || CONFIG.server?.port || 8787;
const TOKEN = process.env.OPENSHOCK_TOKEN || process.env.OPENSHOCK_API_TOKEN || "";
const API_HOST = process.env.OPENSHOCK_API_HOST || CONFIG.server?.apiHost || "api.openshock.app";
const USER_AGENT = process.env.OPENSHOCK_USER_AGENT || CONFIG.server?.userAgent || "OpenShock-Roulette/1.3.0 (local-party-game)";

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

const SHOCKER_CACHE_DEFAULT_MS = 30000;
let shockerCache = {
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
    return { source: path.relative(__dirname, fallback).replace(/\\/g, "/"), shockers, fetchedAt: new Date().toISOString(), warning: errors.length ? `OpenShock unavailable, using fallback. ${errors[0]}` : undefined };
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

function validateEventCards(data) {
  if (!data || typeof data !== "object") throw new Error("Event cards config must be an object");
  data.enabled = Boolean(data.enabled ?? true);
  data.chancePercent = clampInt(data.chancePercent ?? 18, 0, 100);
  data.displayDurationMs = clampInt(data.displayDurationMs ?? 4000, 0, 15000);
  if (!Array.isArray(data.cards)) data.cards = [];

  data.cards = data.cards.map((card, i) => {
    if (!card || typeof card !== "object") throw new Error(`event card ${i} must be an object`);
    if (!card.id) throw new Error(`event card ${i} needs id`);
    card.id = String(card.id);
    card.title = String(card.title || card.id);
    card.description = String(card.description || card.text || "");
    card.enabled = Boolean(card.enabled ?? true);
    card.weight = clampInt(card.weight ?? 1, 0, 1000);
    if (card.effects !== undefined && !Array.isArray(card.effects)) throw new Error(`event card ${card.id} effects must be an array`);
    if (!Array.isArray(card.effects)) card.effects = card.type ? [{ type: String(card.type) }] : [];
    card.effects = card.effects.map(effect => ({ ...effect, type: String(effect.type || "") })).filter(effect => effect.type);
    card.targetWheel = Boolean(card.targetWheel ?? false);
    card.fateWheel = Boolean(card.fateWheel ?? false);
    return card;
  });

  return data;
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object");
  if (!Array.isArray(config.fateWheel)) throw new Error("config.fateWheel must be an array");
  if (!config.fateWheel.length) throw new Error("config.fateWheel must not be empty");
  config.eventCards = config.eventCards || {};
  config.eventCards.enabled = Boolean(config.eventCards.enabled ?? true);
  config.eventCards.chancePercent = clampInt(config.eventCards.chancePercent ?? 18, 0, 100);
  config.eventCards.displayDurationMs = clampInt(config.eventCards.displayDurationMs ?? 4000, 0, 15000);
  config.playerPages = config.playerPages || {};
  {
    const page = pageEnabledFromConfig(config.playerPages, true);
    config.playerPages.enabled = page.enabled;
    delete config.playerPages.qrCodesEnabled;
  }
  config.playerPages.autoRefreshMs = clampInt(config.playerPages.autoRefreshMs ?? 2000, 500, 30000);
  config.playerPages.useShockerIdAsAccessKey = Boolean(config.playerPages.useShockerIdAsAccessKey ?? false);
  config.hostPage = config.hostPage || {};
  {
    const page = pageEnabledFromConfig(config.hostPage, true);
    config.hostPage.enabled = page.enabled;
    delete config.hostPage.qrCodesEnabled;
  }
  delete config.hostPage.accessKey;
  config.hostPage.autoRefreshMs = clampInt(config.hostPage.autoRefreshMs ?? 1500, 500, 30000);
  config.hostPage.allowManualControl = true;
  config.audiencePage = config.audiencePage || {};
  {
    const page = pageEnabledFromConfig(config.audiencePage, true);
    config.audiencePage.enabled = page.enabled;
    delete config.audiencePage.qrCodesEnabled;
  }
  delete config.audiencePage.accessKey;
  config.audiencePage.autoRefreshMs = clampInt(config.audiencePage.autoRefreshMs ?? 2500, 500, 30000);
  config.audiencePage.requireUniqueSession = Boolean(config.audiencePage.requireUniqueSession ?? true);
  config.server = config.server || {};
  config.server.host = String(config.server.host || "0.0.0.0");
  config.server.publicBaseUrl = String(config.server.publicBaseUrl || "");
  config.server.adminLocalhostOnly = Boolean(config.server.adminLocalhostOnly ?? true);
  config.economy = config.economy || {};
  config.economy.objectiveRewardPoints = clampInt(config.economy.objectiveRewardPoints ?? 3, 0, 999);
  config.economy.bodyguardRewardPoints = clampInt(config.economy.bodyguardRewardPoints ?? 2, 0, 999);
  config.economy.blessingCost = clampInt(config.economy.blessingCost ?? 5, 0, 999);
  config.economy.curseCost = clampInt(config.economy.curseCost ?? 5, 0, 999);
  config.economy.shieldCost = clampInt(config.economy.shieldCost ?? 8, 0, 999);
  config.economy.mercyCost = clampInt(config.economy.mercyCost ?? 6, 0, 999);
  config.economy.audienceTokenGrantAmount = clampInt(config.economy.audienceTokenGrantAmount ?? 1, 1, 20);
  config.economy.audienceVoteThreshold = clampInt(config.economy.audienceVoteThreshold ?? 3, 1, 1000);
  config.economy.audienceCooldownSeconds = clampInt(config.economy.audienceCooldownSeconds ?? 20, 0, 3600);
  config.economy.audienceMaxVotesPerRound = clampInt(config.economy.audienceMaxVotesPerRound ?? 1, 1, 100);
  config.economy.hostDefaultPointDonation = clampInt(config.economy.hostDefaultPointDonation ?? 1, 0, 999);
  config.economy.hostDefaultTokenDonationAmount = clampInt(config.economy.hostDefaultTokenDonationAmount ?? 1, 1, 99);
  config.economy.tokenCosts = config.economy.tokenCosts || {};
  config.economy.tokenCosts.shield = clampInt(config.economy.tokenCosts.shield ?? config.economy.shieldCost ?? 8, 0, 999);
  config.economy.tokenCosts.mercy = clampInt(config.economy.tokenCosts.mercy ?? config.economy.mercyCost ?? 6, 0, 999);
  config.economy.tokenCosts.blessing = clampInt(config.economy.tokenCosts.blessing ?? config.economy.blessingCost ?? 5, 0, 999);
  config.economy.tokenCosts.curse = clampInt(config.economy.tokenCosts.curse ?? config.economy.curseCost ?? 5, 0, 999);
  config.economy.tokenCosts.chaos = clampInt(config.economy.tokenCosts.chaos ?? 10, 0, 999);
  config.economy.tokenCosts.guarantee = clampInt(config.economy.tokenCosts.guarantee ?? config.economy.guaranteeTokenCost ?? config.economy.guaranteedPickCost ?? 12, 0, 999);
  config.economy.tokenCosts.immunity = clampInt(config.economy.tokenCosts.immunity ?? config.economy.immunityTokenCost ?? 10, 0, 999);
  config.economy.tokenCosts.doubleShock = clampInt(config.economy.tokenCosts.doubleShock ?? config.economy.doubleShockTokenCost ?? 10, 0, 999);

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
  const requestStartedAt = Date.now();
  let urlForLogging = null;
  res.on("finish", () => {
    try {
      const durationMs = Date.now() - requestStartedAt;
      debugState.counters.incomingTotal += 1;
      if (res.statusCode >= 400) debugState.counters.incomingErrors += 1;
      const entry = {
        time: new Date().toISOString(),
        ip: req.socket?.remoteAddress || "unknown",
        method: req.method,
        path: safeRequestPath(req, urlForLogging),
        statusCode: res.statusCode,
        responseTimeMs: durationMs,
        userAgent: req.headers["user-agent"] || ""
      };
      logIncomingRequest(entry);
      const dbg = debugConfig();
      if (durationMs >= dbg.slowRequestThresholdMs) {
        debugState.counters.slowRequests += 1;
        logSlowRequest({ ...entry, thresholdMs: dbg.slowRequestThresholdMs });
      }
    } catch (err) {
      console.warn(`Could not record request debug log: ${err.message}`);
    }
  });

  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    urlForLogging = url;

    const publicPaths = ["/player", "/player/index.html", "/player/player.js", "/player/player.css", "/player.js", "/player.css", "/host", "/host/index.html", "/host/host.js", "/host/host.css", "/host.js", "/host.css", "/audience", "/audience/index.html", "/audience/audience.js", "/audience/audience.css", "/audience.js", "/audience.css", "/api/player-pages/config"];
    const isPlayerApi = /^\/api\/player\/[^/]+\/(state|action)$/.test(url.pathname);
    const isHostApi = /^\/api\/host\/(state|action|control|audience-vote|objective-events\/ack|spinner|reward|force-player)$/.test(url.pathname);
    const isAudienceApi = /^\/api\/audience\/(state|action|session)$/.test(url.pathname);
    const isPublicPlayerPath = publicPaths.includes(url.pathname) || url.pathname.startsWith("/player/") || isPlayerApi || isHostApi || isAudienceApi;
    if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req) && !isPublicPlayerPath) {
      return sendJson(res, 403, { error: "Admin page/API is available from localhost only. Use /player/<id>?key=<id> for player pages." });
    }

    if (url.pathname === "/diagnostics" || url.pathname === "/debug") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendDiagnosticsHtml(res);
    }

    if (url.pathname === "/api/debug/stats" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, getDebugSnapshot());
    }

    if (url.pathname === "/api/debug/cache" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, getDebugSnapshot().cache);
    }

    if (url.pathname === "/api/debug/requests" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, { incomingRequests: debugState.incomingRequests.slice().reverse(), slowRequests: debugState.slowRequests.slice().reverse() });
    }

    if (url.pathname === "/api/debug/openshock" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, { openShockCalls: debugState.openShockCalls.slice().reverse(), counters: getDebugSnapshot().counters, cache: getDebugSnapshot().cache });
    }

    if (url.pathname === "/api/debug/clear" && req.method === "POST") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      debugState.incomingRequests.length = 0;
      debugState.slowRequests.length = 0;
      debugState.openShockCalls.length = 0;
      debugState.openShockDurations.length = 0;
      for (const key of Object.keys(debugState.counters)) debugState.counters[key] = 0;
      return sendJson(res, 200, { cleared: true });
    }

    // Serve role-page static assets before the dynamic /player/<id> route.
    // Otherwise /player/player.css and /player/player.js are mistaken for player IDs.
    const roleStaticFiles = {
      "/player/index.html": path.join(__dirname, "player", "index.html"),
      "/player/player.css": path.join(__dirname, "player", "player.css"),
      "/player/player.js": path.join(__dirname, "player", "player.js"),
      "/host/index.html": path.join(__dirname, "host", "index.html"),
      "/host/host.css": path.join(__dirname, "host", "host.css"),
      "/host/host.js": path.join(__dirname, "host", "host.js"),
      "/audience/index.html": path.join(__dirname, "audience", "index.html"),
      "/audience/audience.css": path.join(__dirname, "audience", "audience.css"),
      "/audience/audience.js": path.join(__dirname, "audience", "audience.js")
    };

    if (req.method === "GET" && roleStaticFiles[url.pathname]) {
      const assetPath = roleStaticFiles[url.pathname];
      if (!fs.existsSync(assetPath)) return sendJson(res, 404, { error: "Not found", path: url.pathname });
      const ext = path.extname(assetPath).toLowerCase();
      const type =
        ext === ".html" ? "text/html; charset=utf-8" :
        ext === ".css" ? "text/css; charset=utf-8" :
        ext === ".js" ? "application/javascript; charset=utf-8" :
        "application/octet-stream";
      const cacheHeader = ext === ".html" ? "no-store" : "public, max-age=300";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": cacheHeader });
      return fs.createReadStream(assetPath).pipe(res);
    }

    if (url.pathname === "/player" && req.method === "GET") {
      if (!playerPagesConfig().enabled) return sendJson(res, 403, { error: "Player pages are disabled" });
      const playerPath = path.join(__dirname, "player", "index.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(playerPath).pipe(res);
    }

    if (url.pathname.startsWith("/player/") && req.method === "GET" && !path.extname(url.pathname)) {
      if (!playerPagesConfig().enabled) return sendJson(res, 403, { error: "Player pages are disabled" });
      const playerPath = path.join(__dirname, "player", "index.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(playerPath).pipe(res);
    }


    if (url.pathname === "/host" && req.method === "GET") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      const hostPath = path.join(__dirname, "host", "index.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(hostPath).pipe(res);
    }

    if (url.pathname === "/audience" && req.method === "GET") {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      const audiencePath = path.join(__dirname, "audience", "index.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(audiencePath).pipe(res);
    }

    if (url.pathname === "/api/player-pages/config" && req.method === "GET") {
      return sendJson(res, 200, { ...playerPagesConfig(), publicBaseUrl: getPublicBaseUrl(req) });
    }

    if (url.pathname === "/api/player-links" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, await buildPlayerLinks(req));
    }


    if (url.pathname === "/api/role-links" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, await buildRoleLinks(req));
    }

    if (url.pathname === "/api/host/state" && req.method === "GET") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return sendJson(res, 200, await getHostState());
    }

    if (url.pathname === "/api/host/action" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await resolveHostAction(req, res, url);
    }

    if (url.pathname === "/api/host/audience-vote" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await resolveAudienceVote(req, res, url);
    }

    if (url.pathname === "/api/host/objective-events/ack" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await acknowledgeObjectiveEvents(req, res, url);
    }

    if (url.pathname === "/api/host/reward" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await rewardPlayerFromHost(req, res, url);
    }

    if (url.pathname === "/api/host/force-player" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      const targetPlayerId = String(body.targetPlayerId || "");
      if (!targetPlayerId) return sendJson(res, 400, { error: "Pick a target player" });
      const state = readSessionState();
      const modifier = queueRoundModifier(state, { type: "guaranteedPickNextRound", source: "host", targetPlayerId, tokenType: "guarantee" });
      writeSessionState(state);
      return sendJson(res, 200, { ok: true, modifier });
    }


    if (url.pathname === "/api/host/spinner" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      const command = String(body.command || "");
      if (!["spin", "pause", "resume", "forceEventNextRound"].includes(command)) return sendJson(res, 400, { error: "Unsupported spinner command" });
      const state = readSessionState();
      if (command === "forceEventNextRound") {
        const modifier = queueRoundModifier(state, { type: "forceEventNextRound", source: "host" });
        writeSessionState(state);
        return sendJson(res, 200, { ok: true, modifier });
      }
      state.hostCommands = Array.isArray(state.hostCommands) ? state.hostCommands : [];
      if (command === "pause") state.hostPaused = true;
      if (command === "resume" || command === "spin") state.hostPaused = false;
      const item = { id: uuid("cmd"), command, createdAt: new Date().toISOString(), status: "pending" };
      state.hostCommands.push(item);
      writeSessionState(state);
      return sendJson(res, 200, { ok: true, command: item });
    }

    if (url.pathname === "/api/host/spinner-commands" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const state = readSessionState();
      const pending = (state.hostCommands || []).filter(c => c.status === "pending");
      state.hostCommands = (state.hostCommands || []).map(c => c.status === "pending" ? { ...c, status: "consumed", consumedAt: new Date().toISOString() } : c).slice(-50);
      writeSessionState(state);
      return sendJson(res, 200, { commands: pending });
    }

    if (url.pathname === "/api/host/control" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return await handleControl(req, res);
    }

    if (url.pathname === "/api/audience/session" && (req.method === "GET" || req.method === "POST")) {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      return await createOrReadAudienceSession(req, res, url);
    }

    if (url.pathname === "/api/audience/state" && req.method === "GET") {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      if (!validateAudienceAccess(req, url)) return sendJson(res, 403, { error: "Audience page is disabled" });
      const state = readSessionState();
      const audienceSessionId = getAudienceSessionId(req, url);
      const displayName = sanitizeAudienceName(url.searchParams.get("displayName") || "");
      const session = audiencePageConfig().requireUniqueSession ? ensureOrCreateAudienceSession(state, audienceSessionId, displayName) : { id: audienceSessionId || "shared", displayName: displayName || "Audience" };
      writeSessionState(state);
      const players = await publicPlayers();
      return sendJson(res, 200, { roundNumber: state.roundNumber, players, economy: economyConfig(), audiencePage: audiencePageConfig(), audienceSession: session, audienceVoteThresholdEffective: effectiveAudienceVoteThreshold(state), audienceSessions: state.audienceSessions || {}, audienceVotes: (state.audienceVotes || []).map(v => voteView(v, players, state)), audienceEventLog: state.audienceEventLog || [] });
    }

    if (url.pathname === "/api/audience/action" && req.method === "POST") {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      return await handleAudienceAction(req, res, url);
    }

    if (url.pathname === "/api/objectives" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, { definitions: readObjectives(), session: readSessionState() });
    }

    if (url.pathname === "/api/objectives/generate" && req.method === "POST") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const body = await readBody(req);
      const session = await assignObjectivesToPlayers({ resetExisting: Boolean(body.resetExisting ?? true) });
      return sendJson(res, 200, { generated: true, session });
    }

    const playerStateMatch = url.pathname.match(/^\/api\/player\/([^/]+)\/state$/);
    if (playerStateMatch && req.method === "GET") {
      if (!requirePlayerPagesEnabled(req, res)) return;
      const playerId = decodeURIComponent(playerStateMatch[1]);
      if (!validatePlayerAccess(req, playerId, url)) return sendJson(res, 403, { error: "Invalid player key" });
      const { shockers } = await getShockers();
      const player = shockers.find(s => s.id === playerId) || { id: playerId, name: "Unknown player" };
      const sessionState = readSessionState();
      const pendingActions = (sessionState.pendingPlayerActions || [])
        .filter(a => a.status === "pending")
        .filter(a => a.playerId === playerId || a.bodyguardPlayerId === playerId)
        .map(a => pendingActionView(a, shockers));
      const activeBodyguards = (sessionState.pendingRoundModifiers || [])
        .filter(m => m.status !== "consumed" && m.type === "bodyguardNextRound")
        .filter(m => String(m.bodyguardPlayerId) === String(playerId) || String(m.targetPlayerId) === String(playerId))
        .map(m => modifierView(m, shockers));
      const players = shockers.map(s => ({ id: s.id, name: s.name }));
      return sendJson(res, 200, { player, players, ...getPlayerState(playerId), playerPages: playerPagesConfig(), economy: economyConfig(), pendingActions, activeBodyguards });
    }

    const playerActionMatch = url.pathname.match(/^\/api\/player\/([^/]+)\/action$/);
    if (playerActionMatch && req.method === "POST") {
      if (!requirePlayerPagesEnabled(req, res)) return;
      const playerId = decodeURIComponent(playerActionMatch[1]);
      return await handlePlayerAction(req, res, playerId, url);
    }

    if (url.pathname === "/api/config" && req.method === "GET") {
      CONFIG = readConfig();
      return sendJson(res, 200, CONFIG);
    }

    if (url.pathname === "/api/config" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const incoming = await readBody(req);
      const validated = validateConfig(incoming);
      writeConfig(validated);
      CONFIG = validated;
      clearShockerCache();
      return sendJson(res, 200, { saved: true, config: CONFIG });
    }

    if (url.pathname === "/api/config/reset" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      CONFIG = resetGameConfigToDefaults();
      return sendJson(res, 200, { saved: true, reset: true, config: CONFIG });
    }

    if (url.pathname === "/api/event-cards" && req.method === "GET") {
      return sendJson(res, 200, readEventCards());
    }

    if (url.pathname === "/api/round-modifiers/consume" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      return sendJson(res, 200, { consumed: true, pendingRoundModifiers: consumeRoundModifiers(body.ids || []) });
    }


    if (url.pathname === "/api/database/summary" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const db = getDatabase();
      const tables = ["state", "meta", "app_log"];
      const counts = {};
      for (const table of tables) {
        try { counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count; } catch { counts[table] = null; }
      }
      return sendJson(res, 200, { schemaVersion: getMeta("schemaVersion"), appVersion: getMeta("appVersion"), storageMode: getMeta("storageMode"), currentGameId: getCurrentGameId(), counts });
    }


    if (url.pathname === "/api/event-log" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      writeDatabaseEvent(body || {});
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/round-result" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      writeRoundResult(body || {});
      const state = readSessionState();
      processRolePassivesForRoundResult(state, body || {});
      writeSessionState(state);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      return sendJson(res, 200, readSessionState());
    }

    if (url.pathname === "/api/session" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const incoming = await readBody(req);
      const current = readSessionState();
      incoming.playerStats = mergePlayerStatsForSessionSave(incoming.playerStats, current.playerStats);
      incoming.objectiveAssignments = current.objectiveAssignments || {};
      incoming.playerPoints = current.playerPoints || {};
      incoming.playerTokens = current.playerTokens || {};
      incoming.playerMultipliers = incoming.playerMultipliers && typeof incoming.playerMultipliers === "object" ? incoming.playerMultipliers : (current.playerMultipliers || {});
      incoming.pendingRoundModifiers = current.pendingRoundModifiers || [];
      incoming.pendingPlayerActions = current.pendingPlayerActions || [];
      incoming.hiddenRoles = current.hiddenRoles || {};
      incoming.rolePassiveState = current.rolePassiveState || {};
      incoming.completedObjectiveEvents = current.completedObjectiveEvents || [];
      incoming.audienceVotes = current.audienceVotes || [];
      incoming.audienceSessions = current.audienceSessions || {};
      incoming.audienceEventLog = current.audienceEventLog || [];
      incoming.hostCommands = current.hostCommands || [];
      incoming.hostPaused = current.hostPaused || false;
      incoming.roleAccessKeys = current.roleAccessKeys || {};
      return sendJson(res, 200, { saved: true, session: writeSessionState(incoming) });
    }


    if (url.pathname === "/api/player-multipliers" && req.method === "POST") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const body = await readBody(req);
      const state = readSessionState();
      state.playerMultipliers = state.playerMultipliers && typeof state.playerMultipliers === "object" ? state.playerMultipliers : {};
      const updates = body.playerMultipliers && typeof body.playerMultipliers === "object" ? body.playerMultipliers : {};
      for (const [playerId, raw] of Object.entries(updates)) {
        const id = String(playerId || "");
        if (!id) continue;
        const value = clampInt(raw ?? 100, 0, 100);
        state.playerMultipliers[id] = value;
        updatePlayerMultiplierInDatabase(id, value);
      }
      writeSessionState(state);
      const saved = readSessionState().playerMultipliers || state.playerMultipliers;
      return sendJson(res, 200, { ok: true, playerMultipliers: saved });
    }

    if (url.pathname === "/api/session/reset" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const result = resetSessionState();
      return sendJson(res, 200, { reset: true, session: result.session, archivedTo: result.archivedTo });
    }

    if (url.pathname === "/api/shockers" && req.method === "GET") {
      const forceRefresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
      return sendJson(res, 200, await getShockers({ forceRefresh }));
    }

    if (url.pathname === "/api/control" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return await handleControl(req, res);
    }

    if (url.pathname === "/api/stop-all" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return await handleStopAll(req, res);
    }


    const staticAliases = {
      "host.html": path.join("host", "index.html"),
      "host.js": path.join("host", "host.js"),
      "host.css": path.join("host", "host.css"),
      "player.html": path.join("player", "index.html"),
      "player.js": path.join("player", "player.js"),
      "player.css": path.join("player", "player.css"),
      "audience.html": path.join("audience", "index.html"),
      "audience.js": path.join("audience", "audience.js"),
      "audience.css": path.join("audience", "audience.css")
    };

    let requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    requestedPath = staticAliases[requestedPath] || requestedPath;
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

server.listen(PORT, process.env.HOST || CONFIG.server?.host || "0.0.0.0", () => {
  console.log(`${CONFIG.app?.serverBanner || CONFIG.app?.displayTitle || 'OpenShock Roulette'} running at http://localhost:${PORT}`);
  getLanAddresses().forEach(ip => console.log(`Player pages available at http://${ip}:${PORT}/player`));
  console.log(`Config source: ${CONFIG_PATH}; defaults: ${CONFIG_EXAMPLE_PATH}`);
  console.log(`SQLite JSON blob state DB: ${DB_PATH}`);
  if (!TOKEN) console.log("WARNING: OPENSHOCK_TOKEN / OPENSHOCK_API_TOKEN is not set.");
});