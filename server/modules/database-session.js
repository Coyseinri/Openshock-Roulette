// Extracted from server/app.js. Loaded by server/app.js in order.
var DB = null;

var { initializeDatabase, readObjectivesFileNormalized, appendLog } = require("./database-init");

function getDatabase() {
  if (DB) return DB;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  try {
    const { DatabaseSync } = require("node:sqlite");
    DB = new DatabaseSync(DB_PATH);
    DB.exec("PRAGMA journal_mode = WAL");
    DB.exec("PRAGMA foreign_keys = OFF");
  } catch (err) {
    throw new Error(
      "Missing SQLite support. OSR requires Node.js 22 LTS or newer with node:sqlite support. " +
      `node:sqlite error: ${err.message}`
    );
  }

  initializeDatabase(DB, {
    schemaVersion: OSR_SCHEMA_VERSION,
    appVersion: APP_VERSION,
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
    publicObjectiveProgress: {},
    publicObjectiveActiveIds: [],
    publicObjectiveCompletedIds: [],
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
  state.publicObjectiveProgress = data.publicObjectiveProgress && typeof data.publicObjectiveProgress === "object" ? data.publicObjectiveProgress : {};
  state.publicObjectiveActiveIds = Array.isArray(data.publicObjectiveActiveIds) ? data.publicObjectiveActiveIds.map(String).filter(Boolean) : [];
  state.publicObjectiveCompletedIds = Array.isArray(data.publicObjectiveCompletedIds) ? data.publicObjectiveCompletedIds.map(String).filter(Boolean) : [];
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

  // Current schema stores the full live session as a SQLite JSON blob.
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

  return path.relative(APP_ROOT, archivePath).replace(/\\/g, "/");
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

