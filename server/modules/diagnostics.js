// Full diagnostics and safe test helpers.
// Loaded after host-dashboard-actions.js and before routes.js.

function diagnosticsAccessAllowed(req, url) {
  // Diagnostics can expose config, session and device metadata. Keep it local only.
  return isLocalRequest(req);
}

function diagnosticStatus(ok, label, details = null) {
  return { ok: Boolean(ok), label, details };
}


function diagnosticSeverity(ok, severity = "warning") {
  if (ok) return "ok";
  return severity === "error" ? "error" : "warning";
}

const DIAGNOSTIC_KNOWN_EVENT_EFFECTS = new Set([
  "manualTargetByLastShocked", "manualTargetByHost", "groupVoteTarget",
  "excludeLastTarget", "excludeLastShocked", "forcePreviousTarget", "forceLastShockedTarget",
  "forceLeastShockedTarget", "forceMostShockedTarget", "forceLeastSelectedTarget", "forceMostSelectedTarget",
  "forceLeastVibedTarget", "forceMostVibedTarget", "forceLowestIntensityTarget", "forceHighestIntensityTarget",
  "forceLongestNotSelectedTarget", "forceLongestNotShockedTarget", "forceTargetBySelector",
  "multiplyTargetWeight", "disableTargetType", "addVirtualTarget", "doubleTarget", "addRandomTargets",
  "forceAllTargets", "sharePain", "bodyguard", "duel", "chooseFateByTarget", "chooseTargetByTarget",
  "targetChoosesOpponent", "forceVibrateOnly", "forceControlType", "disableFate", "multiplyFateWeight",
  "capFateMax", "capFateCategory", "doubleSafeWeight", "disableSafe", "noMercy", "mercyRound",
  "forceFate", "equalFateWeights", "invertFateWeights", "forceRandomFate", "guaranteedDoubleHit",
  "setDoubleHitChance", "valueMultiplier", "valueOffset", "lastWords",
  "removeSafe", "removeSAFE", "disableSafeTarget", "disableTargetSafe", "noSafeTarget",
  "forceVibe", "vibeOnly", "vibrateOnly"
]);

const DIAGNOSTIC_OBJECTIVE_TYPES = new Set([
  "selected", "shocked", "vibes", "safe", "allTargeted", "bodyguards", "cursesUsed",
  "chaosUsed", "tokensBought", "tokensOwned", "highPlusSurvived", "eventCardsExperienced",
  "sabotageEffects", "redirectedHits", "roundsSinceSelected", "roundsSinceShocked",
  "totalIntensity", "publicProgress", "manual"
]);

function duplicateIds(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items || []) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function validateDiagnosticEventCards(cardsData) {
  const cards = cardsData?.cards || [];
  const checks = [];
  const warnings = [];
  const duplicates = duplicateIds(cards);
  checks.push({ id: "event-duplicate-ids", label: "No duplicate event card IDs", ok: duplicates.length === 0, severity: diagnosticSeverity(duplicates.length === 0), details: duplicates });

  for (const card of cards) {
    const cardId = card?.id || "unknown";
    if (!card?.title) warnings.push(`Event card ${cardId} has no title.`);
    if (!card?.description && !card?.text) warnings.push(`Event card ${cardId} has no description.`);
    if (clampInt(card?.weight ?? 0, 0, 1000000) === 0 && card?.enabled !== false) warnings.push(`Event card ${cardId} is enabled but has weight 0.`);
    const effects = Array.isArray(card?.effects) ? card.effects : [];
    for (const effect of effects) {
      const type = String(effect?.type || "").trim();
      if (!type) warnings.push(`Event card ${cardId} contains an effect without a type.`);
      else if (!DIAGNOSTIC_KNOWN_EVENT_EFFECTS.has(type)) warnings.push(`Event card ${cardId} references unknown effect type '${type}'.`);
    }
  }

  checks.push({ id: "event-effect-types", label: "Event effect types look known", ok: !warnings.some(w => w.includes("unknown effect type") || w.includes("without a type")), severity: warnings.some(w => w.includes("unknown")) ? "warning" : "ok", details: warnings.filter(w => w.includes("effect")) });
  return { total: cards.length, enabled: cards.filter(c => c?.enabled !== false).length, checks, warnings };
}

function validateDiagnosticObjectives(objectivesData) {
  const privateObjectives = objectivesData?.objectives || [];
  const publicObjectives = objectivesData?.publicObjectives || [];
  const hiddenRoles = objectivesData?.hiddenRoles || [];
  const checks = [];
  const warnings = [];
  const privateDuplicates = duplicateIds(privateObjectives);
  const publicDuplicates = duplicateIds(publicObjectives);
  const roleDuplicates = duplicateIds(hiddenRoles);
  checks.push({ id: "objective-duplicate-ids", label: "No duplicate private objective IDs", ok: privateDuplicates.length === 0, severity: diagnosticSeverity(privateDuplicates.length === 0), details: privateDuplicates });
  checks.push({ id: "public-objective-duplicate-ids", label: "No duplicate public objective IDs", ok: publicDuplicates.length === 0, severity: diagnosticSeverity(publicDuplicates.length === 0), details: publicDuplicates });
  checks.push({ id: "role-duplicate-ids", label: "No duplicate hidden role IDs", ok: roleDuplicates.length === 0, severity: diagnosticSeverity(roleDuplicates.length === 0), details: roleDuplicates });

  const inspectObjective = (objective, label) => {
    const id = objective?.id || "unknown";
    if (!objective?.title) warnings.push(`${label} ${id} has no title.`);
    if (objective?.enabled !== false && clampInt(objective?.target ?? 1, 0, 1000000) <= 0) warnings.push(`${label} ${id} has an impossible target.`);
    const type = String(objective?.type || "").trim();
    if (type && !DIAGNOSTIC_OBJECTIVE_TYPES.has(type)) warnings.push(`${label} ${id} uses unknown type '${type}'.`);
  };
  privateObjectives.forEach(o => inspectObjective(o, "Private objective"));
  publicObjectives.forEach(o => inspectObjective(o, "Public objective"));
  for (const role of hiddenRoles) {
    const id = role?.id || "unknown";
    if (!role?.title) warnings.push(`Hidden role ${id} has no title.`);
    const trigger = String(role?.triggerType || "").trim();
    if (trigger && !DIAGNOSTIC_OBJECTIVE_TYPES.has(trigger)) warnings.push(`Hidden role ${id} uses unknown triggerType '${trigger}'.`);
    if (role?.enabled !== false && clampInt(role?.triggerTarget ?? 1, 0, 1000000) <= 0) warnings.push(`Hidden role ${id} has an impossible trigger target.`);
  }

  checks.push({ id: "objective-types", label: "Objective and role types look known", ok: !warnings.some(w => w.includes("unknown type") || w.includes("unknown triggerType")), severity: "warning", details: warnings.filter(w => w.includes("unknown")) });
  return { privateCount: privateObjectives.length, publicCount: publicObjectives.length, hiddenRoleCount: hiddenRoles.length, checks, warnings };
}

function safeReadJsonFile(filePath, label) {
  const rel = path.relative(APP_ROOT, filePath).replace(/\\/g, "/");
  try {
    if (!fs.existsSync(filePath)) return { label, path: rel, exists: false, ok: false, error: "Missing file" };
    const raw = fs.readFileSync(filePath, "utf8");
    JSON.parse(raw);
    return { label, path: rel, exists: true, ok: true, sizeBytes: Buffer.byteLength(raw, "utf8") };
  } catch (err) {
    return { label, path: rel, exists: true, ok: false, error: err.message };
  }
}

function tailTextFile(filePath, maxLines = 50) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-maxLines).map(line => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    }).reverse();
  } catch (err) {
    return [{ error: err.message }];
  }
}

function getDatabaseSummary() {
  const summary = {
    ok: false,
    path: path.relative(APP_ROOT, DB_PATH).replace(/\\/g, "/"),
    schemaVersion: null,
    appVersion: null,
    storageMode: null,
    currentGameId: null,
    counts: {},
    recentEvents: [],
    error: null
  };
  try {
    const db = getDatabase();
    const tables = ["state", "meta", "app_log"];
    for (const table of tables) {
      try { summary.counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count; } catch { summary.counts[table] = null; }
    }
    summary.schemaVersion = getMeta("schemaVersion");
    summary.appVersion = getMeta("appVersion");
    summary.storageMode = getMeta("storageMode");
    summary.currentGameId = getCurrentGameId();
    try {
      summary.recentEvents = db.prepare("SELECT id, type, title, description, created_at FROM app_log ORDER BY id DESC LIMIT 50").all();
    } catch { summary.recentEvents = []; }
    summary.ok = true;
  } catch (err) {
    summary.error = err.message;
  }
  return summary;
}

function getConfigValidationSummary() {
  const checks = [];
  const warnings = [];
  const files = [
    safeReadJsonFile(CONFIG_EXAMPLE_PATH, "Config defaults"),
    safeReadJsonFile(CONFIG_PATH, "Live config"),
    safeReadJsonFile(EVENT_CARDS_EXAMPLE_PATH, "Event card defaults"),
    safeReadJsonFile(EVENT_CARDS_PATH, "Live event cards"),
    safeReadJsonFile(OBJECTIVES_EXAMPLE_PATH, "Objective defaults"),
    safeReadJsonFile(OBJECTIVES_PATH, "Live objectives"),
    safeReadJsonFile(SHOCKERS_EXAMPLE_PATH, "Fallback shocker defaults"),
    safeReadJsonFile(SHOCKERS_PATH, "Fallback shockers")
  ];

  try {
    const cfg = readConfig();
    checks.push(diagnosticStatus(true, "Runtime config loaded", { source: path.relative(APP_ROOT, CONFIG_PATH).replace(/\\/g, "/") }));
    const maxShock = clampInt(cfg.safety?.serverMaxShockIntensity ?? 0, 0, 1000);
    if (maxShock < 1 || maxShock > 99) warnings.push(`serverMaxShockIntensity is ${maxShock}; expected 1-99 for OSR safety policy.`);
    const grouping = shockerGroupingConfig();
    if (grouping.enabled && !grouping.separator) warnings.push("Shocker grouping is enabled but separator is empty.");
  } catch (err) {
    checks.push(diagnosticStatus(false, "Runtime config failed", err.message));
    warnings.push(`Runtime config error: ${err.message}`);
  }

  try {
    const cards = readEventCards();
    const cardValidation = validateDiagnosticEventCards(cards);
    checks.push(diagnosticStatus(true, "Event cards loaded", { count: (cards.cards || []).length, enabled: cards.enabled }));
    checks.push(...cardValidation.checks);
    warnings.push(...cardValidation.warnings);
  } catch (err) {
    checks.push(diagnosticStatus(false, "Event cards failed", err.message));
    warnings.push(`Event card error: ${err.message}`);
  }

  try {
    const objectives = readObjectives();
    const objectiveValidation = validateDiagnosticObjectives(objectives);
    checks.push(diagnosticStatus(true, "Objectives loaded", {
      privateObjectives: (objectives.objectives || []).length,
      publicObjectives: (objectives.publicObjectives || []).length,
      hiddenRoles: (objectives.hiddenRoles || []).length
    }));
    checks.push(...objectiveValidation.checks);
    warnings.push(...objectiveValidation.warnings);
  } catch (err) {
    checks.push(diagnosticStatus(false, "Objectives failed", err.message));
    warnings.push(`Objective error: ${err.message}`);
  }

  if (!TOKEN) warnings.push("OPENSHOCK_TOKEN / OPENSHOCK_API_TOKEN is not set. OpenShock calls will fail.");
  return { files, checks, warnings };
}

function getGitInfo() {
  try {
    const cp = require("child_process");
    const branch = cp.execSync("git rev-parse --abbrev-ref HEAD", { cwd: APP_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const commit = cp.execSync("git rev-parse --short HEAD", { cwd: APP_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = cp.execSync("git status --porcelain", { cwd: APP_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { available: true, branch, commit, dirty: Boolean(dirty) };
  } catch {
    return { available: false };
  }
}

function summarizeMemoryUsage() {
  const mem = process.memoryUsage();
  const mb = value => Math.round((value / 1024 / 1024) * 10) / 10;
  return {
    rssMb: mb(mem.rss),
    heapUsedMb: mb(mem.heapUsed),
    heapTotalMb: mb(mem.heapTotal),
    externalMb: mb(mem.external || 0)
  };
}

function sessionSummary(state, players) {
  return {
    roundNumber: state.roundNumber,
    updatedAt: state.updatedAt,
    hostPaused: Boolean(state.hostPaused),
    players: players.length,
    groupedPlayers: players.filter(p => p.isGrouped).length,
    physicalDevices: players.reduce((sum, p) => sum + (p.devices || []).length, 0),
    publicObjectivesActive: (state.publicObjectiveActiveIds || []).length,
    publicObjectivesCompleted: (state.publicObjectiveCompletedIds || []).length,
    pendingRoundModifiers: (state.pendingRoundModifiers || []).length,
    pendingPlayerActions: (state.pendingPlayerActions || []).length,
    objectiveEvents: (state.completedObjectiveEvents || []).length,
    audienceVotes: (state.audienceVotes || []).length,
    audienceSessions: Object.keys(state.audienceSessions || {}).length,
    eliminatedIds: state.eliminatedIds || []
  };
}


function readOnlyPublicObjectiveViews(state) {
  let catalog = { publicObjectives: [] };
  try { catalog = readObjectives(); } catch { catalog = { publicObjectives: [] }; }
  const defs = new Map((catalog.publicObjectives || []).filter(o => o && o.id).map(o => [String(o.id), o]));
  const activeIds = Array.isArray(state?.publicObjectiveActiveIds) ? state.publicObjectiveActiveIds.map(String) : [];
  const progressMap = state?.publicObjectiveProgress && typeof state.publicObjectiveProgress === "object" ? state.publicObjectiveProgress : {};
  return activeIds.map(id => {
    const def = defs.get(id) || { id, title: id, target: progressMap[id]?.target || 1 };
    const progress = progressMap[id] || {};
    const reward = def.reward && typeof def.reward === "object" ? def.reward : {};
    return {
      id,
      title: def.title || id,
      description: def.description || "",
      type: def.type || "",
      progress: clampInt(progress.progress ?? 0, 0, progress.target ?? def.target ?? 1000000),
      target: clampInt(progress.target ?? def.target ?? 1, 1, 1000000),
      completed: Boolean(progress.completed),
      rewardClaimed: Boolean(progress.rewardClaimed),
      rewardPoints: clampInt(def.rewardPoints ?? reward.points ?? 0, 0, 999),
      rewardTokens: reward.tokens || def.rewardTokens || [],
      assignedAt: progress.assignedAt || null,
      baseline: progress.baseline ?? null
    };
  });
}

function groupDeviceViews(players, state) {
  const multipliers = state.playerMultipliers || {};
  return (players || []).map(player => ({
    id: player.id,
    name: player.name,
    isGrouped: Boolean(player.isGrouped),
    multiplier: clampInt(multipliers[player.id] ?? 100, 0, 100),
    devices: (player.devices || []).map(device => ({
      id: device.id,
      name: device.name,
      memberName: device.memberName || device.name,
      multiplier: clampInt(multipliers[device.id] ?? 100, 0, 100)
    }))
  }));
}


function redactSecretText(value) {
  return String(value || "").replace(/([?&](?:key|token|access_key|api_key)=)[^&\s]+/gi, "$1[REDACTED]");
}

function redactDiagnosticsValue(value, key = "") {
  const lowered = String(key || "").toLowerCase();
  if (["token", "apikey", "api_key", "openshock_token", "openshock_api_token"].some(s => lowered.includes(s))) return "[REDACTED]";
  if (lowered.includes("accesskey") || lowered === "key" || lowered.endsWith("key")) return "[REDACTED]";
  if (typeof value === "string") return redactSecretText(value);
  if (Array.isArray(value)) return value.map(item => redactDiagnosticsValue(item, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = redactDiagnosticsValue(childValue, childKey);
    return out;
  }
  return value;
}

function redactDiagnosticsExport(data) {
  const redacted = redactDiagnosticsValue(data);
  redacted.export = { redacted: true, redactedAt: new Date().toISOString(), note: "Access keys, tokens and query-string credentials are replaced with [REDACTED]." };
  return redacted;
}

function buildApiKeyCheckSummary(shockerResult = null) {
  const source = String(shockerResult?.source || "");
  const loadedFromOpenShock = source.startsWith("/") && !shockerResult?.warning;
  return {
    tokenConfigured: Boolean(TOKEN),
    apiHost: API_HOST,
    readOwnShockers: {
      ok: Boolean(TOKEN) && loadedFromOpenShock,
      tested: Boolean(TOKEN),
      source: shockerResult?.source || null,
      shockerCount: (shockerResult?.shockers || []).length,
      warning: shockerResult?.warning || null,
      errors: shockerResult?.errors || []
    },
    controlPermission: {
      ok: null,
      tested: false,
      safeTestAvailable: true,
      note: "Use the API key check endpoint with control=true. It sends Stop only, never shock/vibrate."
    }
  };
}

async function runApiKeyPermissionCheck({ testControl = false } = {}) {
  const result = buildApiKeyCheckSummary(null);
  result.checkedAt = new Date().toISOString();
  if (!TOKEN) {
    result.readOwnShockers = { ok: false, tested: false, error: "No OpenShock token configured" };
    return result;
  }

  clearShockerCache();
  let shockerResult = null;
  try {
    shockerResult = await getShockers({ forceRefresh: true });
    Object.assign(result, buildApiKeyCheckSummary(shockerResult));
  } catch (err) {
    result.readOwnShockers = { ok: false, tested: true, error: err.message };
  }

  if (!testControl) return result;
  const first = (shockerResult?.shockers || [])[0];
  if (!first?.id) {
    result.controlPermission = { ok: false, tested: true, error: "No shocker available for safe Stop permission test" };
    return result;
  }

  const s = safety();
  const requestBody = { shocks: [{ id: first.id, type: "Stop", intensity: 0, duration: s.minDurationMs ?? 300, exclusive: true }] };
  try {
    const control = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: "diagnostics:apiKeyStopPermission" });
    result.controlPermission = {
      ok: control.statusCode >= 200 && control.statusCode < 300,
      tested: true,
      statusCode: control.statusCode,
      deviceName: first.name,
      deviceId: first.id,
      responseSummary: summarizeOpenShockResponse(control.body)
    };
  } catch (err) {
    result.controlPermission = { ok: false, tested: true, error: err.message, deviceName: first.name, deviceId: first.id };
  }
  return result;
}

async function buildDiagnosticsState({ forceRefresh = false } = {}) {
  CONFIG = readConfig();
  const state = readSessionState();
  let shockerResult = { source: "none", shockers: [], warning: null, errors: [] };
  try {
    shockerResult = await getShockers({ forceRefresh });
  } catch (err) {
    shockerResult = { source: "error", shockers: [], warning: err.message, errors: [err.message] };
  }
  const players = buildLogicalPlayersFromShockers(shockerResult.shockers || []);
  const debug = getDebugSnapshot();
  const db = getDatabaseSummary();
  const configValidation = getConfigValidationSummary();
  const publicObjectives = readOnlyPublicObjectiveViews(state);
  const eventCards = (() => { try { return readEventCards(); } catch { return { cards: [] }; } })();

  const configDiff = configDiffSummary();
  const targetOdds = buildTargetProbability(players);
  const fateOdds = buildFateProbability();
  const inspectors = buildInspectorData(state, players);
  const storage = buildStorageExplorer(db);
  const links = await buildQrLinkDiagnostics(players);
  const preflight = buildPreflightChecks(state, players, shockerResult, configValidation, db);
  const developer = buildDeveloperToolsSummary(players);
  const apiKeyCheck = buildApiKeyCheckSummary(shockerResult);

  return {
    generatedAt: new Date().toISOString(),
    system: {
      appVersion: APP_VERSION,
      packageName: PACKAGE_JSON.name,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memory: summarizeMemoryUsage(),
      appRoot: APP_ROOT,
      dataDir: path.relative(APP_ROOT, DATA_DIR).replace(/\\/g, "/"),
      logDir: path.relative(APP_ROOT, LOG_DIR).replace(/\\/g, "/"),
      git: getGitInfo()
    },
    server: {
      access: { diagnosticsLocalhostOnly: true },
      port: PORT,
      host: CONFIG.server?.host || "0.0.0.0",
      publicBaseUrl: CONFIG.server?.publicBaseUrl || "",
      adminLocalhostOnly: CONFIG.server?.adminLocalhostOnly !== false,
      apiHost: API_HOST,
      userAgent: USER_AGENT,
      tokenConfigured: Boolean(TOKEN),
      apiKeyCheck,
      openShockTimeoutMs: CONFIG.server?.openShockTimeoutMs || 2500
    },
    safety: safety(),
    configValidation,
    database: db,
    debug,
    shockers: {
      source: shockerResult.source,
      warning: shockerResult.warning || null,
      errors: shockerResult.errors || [],
      cached: Boolean(shockerResult.cached),
      stale: Boolean(shockerResult.stale),
      fetchedAt: shockerResult.fetchedAt || null,
      cacheExpiresInMs: shockerResult.cacheExpiresInMs || 0,
      physicalCount: (shockerResult.shockers || []).length,
      physical: (shockerResult.shockers || []).map(s => ({ id: s.id, name: s.name })),
      grouping: shockerGroupingConfig(),
      logicalCount: players.length,
      groups: groupDeviceViews(players, state)
    },
    game: {
      session: sessionSummary(state, players),
      publicObjectives,
      eventCards: {
        enabled: eventCards.enabled,
        chancePercent: eventCards.chancePercent,
        total: (eventCards.cards || []).length,
        enabledCount: (eventCards.cards || []).filter(c => c.enabled !== false).length
      },
      rawSession: state
    },
    logs: {
      incoming: tailTextFile(path.join(LOG_DIR, "incoming-api.log"), 50),
      openshock: tailTextFile(path.join(LOG_DIR, "openshock-api.log"), 50),
      slow: tailTextFile(path.join(LOG_DIR, "slow-requests.log"), 50),
      databaseEvents: db.recentEvents || []
    },
    tools: {
      preflight,
      apiExplorer: { routes: diagnosticRouteCatalog(), recentRequests: debug.incomingRequests || [], recentOpenShock: debug.openShockCalls || [] },
      inspector: inspectors,
      odds: { target: targetOdds, fate: fateOdds },
      simulator: { defaultRounds: 1000, preview: simulateDiagnosticRounds(players, 250) },
      configDiff,
      storage,
      links,
      developer,
      timeline: (db.recentEvents || []).map(e => ({ time: e.created_at, type: e.type, title: e.title, description: e.description }))
    }
  };
}


function flattenDiagnosticKeys(value, prefix = "") {
  const keys = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return keys;
  for (const key of Object.keys(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    keys.push(next);
    if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) keys.push(...flattenDiagnosticKeys(value[key], next));
  }
  return keys;
}

function configDiffSummary() {
  const result = { ok: false, missingFromLive: [], extraInLive: [], exampleKeys: 0, liveKeys: 0, error: null };
  try {
    const example = fs.existsSync(CONFIG_EXAMPLE_PATH) ? JSON.parse(fs.readFileSync(CONFIG_EXAMPLE_PATH, "utf8")) : {};
    const live = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {};
    const exampleKeys = new Set(flattenDiagnosticKeys(example));
    const liveKeys = new Set(flattenDiagnosticKeys(live));
    result.exampleKeys = exampleKeys.size;
    result.liveKeys = liveKeys.size;
    result.missingFromLive = [...exampleKeys].filter(k => !liveKeys.has(k)).sort();
    result.extraInLive = [...liveKeys].filter(k => !exampleKeys.has(k)).sort();
    result.ok = true;
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

function diagnosticRouteCatalog() {
  return [
    { method: "GET", path: "/", category: "page", description: "Main game screen" },
    { method: "GET", path: "/host", category: "page", description: "Host dashboard" },
    { method: "GET", path: "/player", category: "page", description: "Player pages" },
    { method: "GET", path: "/audience", category: "page", description: "Audience page" },
    { method: "GET", path: "/diagnostics", category: "page", description: "Diagnostics and test page" },
    { method: "GET", path: "/api/state", category: "game", description: "Main game state" },
    { method: "GET", path: "/api/shockers", category: "game", description: "Loaded shockers" },
    { method: "GET", path: "/api/objectives", category: "game", description: "Objective definitions/status" },
    { method: "GET", path: "/api/host/state", category: "host", description: "Host state" },
    { method: "POST", path: "/api/host/control", category: "host", description: "Manual host control" },
    { method: "GET", path: "/api/diagnostics/state", category: "diagnostics", description: "Full diagnostics snapshot" },
    { method: "GET", path: "/api/diagnostics/export", category: "diagnostics", description: "Diagnostics JSON export" },
    { method: "POST", path: "/api/diagnostics/test", category: "diagnostics", description: "Safe test action" },
    { method: "POST", path: "/api/diagnostics/stop-all", category: "diagnostics", description: "Diagnostics STOP ALL" },
    { method: "POST", path: "/api/diagnostics/simulate", category: "diagnostics", description: "Dry-run spinner simulator" },
    { method: "GET", path: "/api/diagnostics/preflight", category: "diagnostics", description: "Readiness checklist" }
  ];
}

function buildTargetProbability(players) {
  const targetCfg = CONFIG?.spinners?.target || {};
  const playerWeight = clampInt(targetCfg.playerWeight ?? 100, 0, 1000000);
  const safeWeight = clampInt(targetCfg.safeWeight ?? 0, 0, 1000000);
  const allWeight = clampInt(targetCfg.shockAllWeight ?? targetCfg.allWeight ?? 0, 0, 1000000);
  const segments = [];
  for (const player of players || []) segments.push({ id: player.id, name: player.name, type: "player", weight: playerWeight });
  if (safeWeight > 0) segments.push({ id: "safe", name: "SAFE", type: "safe", weight: safeWeight });
  if (allWeight > 0) segments.push({ id: "all", name: "SHOCK ALL", type: "all", weight: allWeight });
  const total = segments.reduce((sum, s) => sum + Math.max(0, Number(s.weight || 0)), 0);
  return { totalWeight: total, segments: segments.map(s => ({ ...s, probabilityPercent: total ? Math.round((s.weight / total) * 10000) / 100 : 0 })) };
}

function buildFateProbability() {
  const fate = Array.isArray(CONFIG?.spinners?.fate) ? CONFIG.spinners.fate : [];
  const segments = fate.filter(f => f && f.enabled !== false && clampInt(f.weight ?? 0, 0, 1000000) > 0).map(f => ({ key: f.key, name: f.name || f.key, min: f.min, max: f.max, weight: clampInt(f.weight ?? 0, 0, 1000000) }));
  const total = segments.reduce((sum, s) => sum + s.weight, 0);
  return { totalWeight: total, segments: segments.map(s => ({ ...s, probabilityPercent: total ? Math.round((s.weight / total) * 10000) / 100 : 0 })) };
}

function weightedPick(items) {
  const total = items.reduce((sum, i) => sum + Math.max(0, Number(i.weight || 0)), 0);
  if (!total) return null;
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= Math.max(0, Number(item.weight || 0));
    if (roll <= 0) return item;
  }
  return items[items.length - 1] || null;
}

function simulateDiagnosticRounds(players, count = 1000) {
  count = clampInt(count, 1, 100000);
  const target = buildTargetProbability(players);
  const fate = buildFateProbability();
  const targetCounts = {};
  const fateCounts = {};
  const targetSegments = target.segments.filter(s => s.weight > 0);
  const fateSegments = fate.segments.filter(s => s.weight > 0);
  for (let i = 0; i < count; i += 1) {
    const t = weightedPick(targetSegments);
    if (t) targetCounts[t.name] = (targetCounts[t.name] || 0) + 1;
    const f = weightedPick(fateSegments);
    if (f) fateCounts[f.name] = (fateCounts[f.name] || 0) + 1;
  }
  const toRows = counts => Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, hits]) => ({ name, hits, percent: Math.round((hits / count) * 10000) / 100 }));
  return { rounds: count, target: { probabilities: target, results: toRows(targetCounts) }, fate: { probabilities: fate, results: toRows(fateCounts) } };
}

function buildInspectorData(state, players) {
  let objectives = { enabled: true, assignmentsPerPlayer: 0, objectives: [], publicObjectives: [], hiddenRoles: [] };
  let cards = { enabled: false, chancePercent: 0, cards: [] };
  try { objectives = readObjectives(); } catch (err) { objectives.error = err.message; }
  try { cards = readEventCards(); } catch (err) { cards.error = err.message; }
  return {
    eventCards: {
      enabled: cards.enabled !== false,
      chancePercent: cards.chancePercent ?? CONFIG?.events?.eventCards?.chancePercent ?? 0,
      cards: (cards.cards || []).map(c => ({ id: c.id, title: c.title || c.id, enabled: c.enabled !== false, weight: c.weight ?? 0, targetWheel: Boolean(c.targetWheel), fateWheel: Boolean(c.fateWheel), type: c.type || null, category: c.category || null, effectsCount: Array.isArray(c.effects) ? c.effects.length : 0, description: c.description || "", raw: c }))
    },
    objectives: {
      assignmentsPerPlayer: objectives.assignmentsPerPlayer,
      private: (objectives.objectives || []).map(o => ({ id: o.id, title: o.title || o.id, type: o.type, target: o.target, rewardPoints: o.rewardPoints ?? 0, enabled: o.enabled !== false, raw: o })),
      public: (objectives.publicObjectives || []).map(o => ({ id: o.id, title: o.title || o.id, type: o.type, target: o.target, rewardPoints: o.rewardPoints ?? o.reward?.points ?? 0, enabled: o.enabled !== false, raw: o })),
      roles: (objectives.hiddenRoles || []).map(r => ({ id: r.id, title: r.title || r.id, triggerType: r.triggerType || null, triggerTarget: r.triggerTarget || null, rewardPoints: r.rewardPoints ?? 0, rewardToken: r.rewardToken || null, enabled: r.enabled !== false, raw: r }))
    },
    players: (players || []).map(p => ({ id: p.id, name: p.name, isGrouped: Boolean(p.isGrouped), devices: (p.devices || []).map(d => ({ id: d.id, name: d.name, memberName: d.memberName || d.name })) })),
    sessionKeys: state && typeof state === "object" ? Object.keys(state).sort() : []
  };
}

function buildStorageExplorer(dbSummary) {
  const files = [];
  for (const filePath of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, CONFIG_PATH, EVENT_CARDS_PATH, OBJECTIVES_PATH, SHOCKERS_PATH]) {
    try {
      files.push({ path: path.relative(APP_ROOT, filePath).replace(/\\/g, "/"), exists: fs.existsSync(filePath), sizeBytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0 });
    } catch (err) {
      files.push({ path: path.relative(APP_ROOT, filePath).replace(/\\/g, "/"), exists: false, error: err.message });
    }
  }
  return { files, database: dbSummary };
}

async function buildQrLinkDiagnostics(players) {
  const base = CONFIG?.server?.publicBaseUrl || `http://localhost:${PORT}`;
  const hostKey = getRoleAccessKey("host");
  const audienceKey = getRoleAccessKey("audience");
  const host = `${base}/host?key=${encodeURIComponent(hostKey)}`;
  const audience = `${base}/audience?key=${encodeURIComponent(audienceKey)}`;
  const diagnostics = `${base}/diagnostics?key=${encodeURIComponent(hostKey)}`;
  const playerLinks = (players || []).map(p => ({ id: p.id, name: p.name, url: `${base}/player/${encodeURIComponent(p.id)}?key=${encodeURIComponent(getPlayerAccessKey(p.id))}` }));
  const makeQr = async value => {
    try { return await cachedQrDataUrl(value, { margin: 1, width: 180 }); } catch { return null; }
  };
  return {
    baseUrl: base,
    host,
    audience,
    diagnostics,
    qrCodesEnabled: true,
    qrs: {
      host: await makeQr(host),
      audience: await makeQr(audience),
      diagnostics: await makeQr(diagnostics)
    },
    players: await Promise.all(playerLinks.map(async p => ({ ...p, qrDataUrl: await makeQr(p.url) })))
  };
}

function buildDeveloperToolsSummary(players) {
  return {
    fakePlayers: { available: false, note: "Planned. Should generate browser-only dry-run players without touching real OpenShock devices." },
    fakeAudience: { available: false, note: "Planned. Should simulate votes against current thresholds." },
    dryRunRounds: { available: true, endpoint: "/api/diagnostics/simulate" },
    eventReplay: { available: false, note: "Planned. Needs round history normalization first." },
    currentPlayerCount: (players || []).length
  };
}

function buildPreflightChecks(state, players, shockerResult, configValidation, db) {
  const checks = [];
  const add = (id, label, ok, severity = "error", details = null) => checks.push({ id, label, ok: Boolean(ok), severity, details });
  add("config", "Runtime config loads", !configValidation.checks.some(c => !c.ok), "error", configValidation.checks);
  add("sqlite", "SQLite/session database healthy", db.ok, "error", db.error || db.counts);
  const apiKeyCheck = buildApiKeyCheckSummary(shockerResult);
  add("token", "OpenShock token configured", Boolean(TOKEN), "error");
  add("api-read", "OpenShock token can read own shockers", apiKeyCheck.readOwnShockers.ok, "error", apiKeyCheck.readOwnShockers);
  add("shockers", "At least one shocker loaded", (shockerResult.shockers || []).length > 0, "error", shockerResult.warning || null);
  add("players", "At least one logical player available", (players || []).length > 0, "error");
  add("grouping", "Grouping config valid", !(shockerGroupingConfig().enabled && !shockerGroupingConfig().separator), "warning", shockerGroupingConfig());
  add("events", "Event cards loaded", !configValidation.warnings.some(w => /^Event card error/.test(w)), "warning");
  add("objectives", "Objectives loaded", !configValidation.warnings.some(w => /^Objective error/.test(w)), "warning");
  add("safety", "Server max shock is within OSR limit", clampInt(CONFIG?.safety?.serverMaxShockIntensity ?? 0, 0, 1000) <= 99 && clampInt(CONFIG?.safety?.serverMaxShockIntensity ?? 0, 0, 1000) > 0, "error", CONFIG?.safety);
  add("host", "Host page enabled", CONFIG?.pages?.host?.enabled !== false, "warning");
  add("player", "Player pages enabled", CONFIG?.pages?.player?.enabled !== false, "warning");
  add("audience", "Audience page enabled", CONFIG?.pages?.audience?.enabled !== false, "warning");
  const failed = checks.filter(c => !c.ok && c.severity === "error").length;
  const warnings = checks.filter(c => !c.ok && c.severity !== "error").length;
  return { ready: failed === 0, failed, warnings, checks };
}

function multiplierForDiagnosticTarget(state, device, fallbackPlayerId = null) {
  const multipliers = state?.playerMultipliers && typeof state.playerMultipliers === "object" ? state.playerMultipliers : {};
  return clampInt(multipliers[device.id] ?? multipliers[fallbackPlayerId] ?? 100, 0, 100);
}

function applyDiagnosticMultiplier(value, multiplierPercent, maxShock) {
  if (value <= 0) return 0;
  return clampInt(Math.max(1, Math.round(value * (multiplierPercent / 100))), 1, maxShock);
}

async function resolveDiagnosticTestDevices(body) {
  const targetType = String(body.targetType || "device");
  const targetId = String(body.targetId || body.id || "");
  const { shockers } = await getShockers();
  const players = buildLogicalPlayersFromShockers(shockers);

  if (targetType === "all") {
    return shockers.map(s => ({ id: s.id, name: s.name, memberName: s.name, playerId: s.id, playerName: s.name }));
  }
  if (targetType === "group") {
    const player = findLogicalPlayerById(players, targetId);
    if (!player) return [];
    return player.devices.map(d => ({ ...d, playerId: player.id, playerName: player.name }));
  }
  const direct = shockers.find(s => String(s.id) === String(targetId));
  if (direct) return [{ id: direct.id, name: direct.name, memberName: direct.name, playerId: direct.id, playerName: direct.name }];
  return resolveLogicalControlDevices(targetId);
}

async function handleDiagnosticsTest(req, res) {
  const body = await readBody(req);
  const s = safety();
  const maxShock = clampInt(s.serverMaxShockIntensity ?? 99, 1, 99);
  const maxVibe = clampInt(s.serverMaxVibrateIntensity ?? 100, 1, 100);
  const duration = clampInt(body.duration ?? s.defaultDurationMs ?? 700, s.minDurationMs ?? 300, s.maxDurationMs ?? 1000);
  const exclusive = Boolean(body.exclusive ?? true);
  const mode = String(body.mode || body.type || "Vibrate");
  const normalizedType = mode.toLowerCase() === "shock" ? "Shock" : mode.toLowerCase() === "stop" ? "Stop" : "Vibrate";
  const selectedValue = normalizedType === "Shock" ? clampInt(body.selectedValue ?? body.intensity ?? 5, 1, maxShock) : 0;
  const devices = await resolveDiagnosticTestDevices(body);
  if (!devices.length) return sendJson(res, 404, { error: "No matching devices found" });

  const state = readSessionState();
  const shocks = devices.map(device => {
    const multiplierPercent = normalizedType === "Shock" ? multiplierForDiagnosticTarget(state, device, device.playerId) : null;
    const intensity = normalizedType === "Shock"
      ? applyDiagnosticMultiplier(selectedValue, multiplierPercent, maxShock)
      : normalizedType === "Vibrate"
        ? maxVibe
        : 0;
    return {
      id: device.id,
      type: normalizedType,
      intensity,
      duration,
      exclusive,
      selectedValue,
      maxShock,
      multiplierPercent,
      playerId: device.playerId,
      playerName: device.playerName,
      deviceName: device.name,
      memberName: device.memberName || device.name
    };
  });

  const requestBody = {
    shocks: shocks.map(({ id, type, intensity, duration, exclusive }) => ({ id, type, intensity, duration, exclusive }))
  };

  if (normalizedType === "Stop") debugState.counters.stopCommands += shocks.length;
  else debugState.counters.shockCommands += shocks.length;

  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: `diagnostics:${normalizedType.toLowerCase()}` });
  writeDatabaseEvent({ type: "diagnosticsTest", title: `Diagnostics ${normalizedType}`, description: `${normalizedType} sent to ${shocks.length} device(s)`, metadata: { sent: shocks } });
  return sendJson(res, result.statusCode, { ok: result.statusCode >= 200 && result.statusCode < 300, sent: shocks, openshock: result.body });
}

async function handleDiagnosticsStopAll(req, res) {
  let ids = [];
  try {
    const body = await readBody(req);
    ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  } catch {
    ids = [];
  }
  if (!ids.length) {
    const { shockers } = await getShockers();
    ids = (shockers || []).map(s => String(s.id)).filter(Boolean);
  }
  if (!ids.length) return sendJson(res, 400, { error: "No shocker ids available" });
  const s = safety();
  const requestBody = {
    shocks: ids.map(id => ({ id, type: "Stop", intensity: 0, duration: s.minDurationMs ?? 300, exclusive: true }))
  };
  debugState.counters.stopCommands += ids.length;
  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: "diagnostics:stopAll" });
  writeDatabaseEvent({ type: "diagnosticsStopAll", title: "Diagnostics STOP ALL", description: `Stop sent to ${ids.length} device(s)`, metadata: { ids } });
  return sendJson(res, result.statusCode, { stopped: ids.length, ids, openshock: result.body });
}

async function handleDiagnosticsReloadShockers(_req, res) {
  clearShockerCache();
  const result = await getShockers({ forceRefresh: true });
  return sendJson(res, 200, { ok: true, shockers: result });
}

async function handleDiagnosticsSimulate(req, res) {
  let body = {};
  try {
    body = await readBody(req);
  } catch {
    body = {};
  }
  const count = clampInt(body.rounds ?? body.count ?? 1000, 1, 100000);
  let shockers = [];
  try {
    const result = await getShockers();
    shockers = result.shockers || [];
  } catch {
    shockers = [];
  }
  const players = buildLogicalPlayersFromShockers(shockers || []);
  return sendJson(res, 200, simulateDiagnosticRounds(players, count));
}

async function handleDiagnosticsPreflight(_req, res) {
  const state = await buildDiagnosticsState({ forceRefresh: true });
  return sendJson(res, 200, state.tools.preflight);
}

function handleDiagnosticsClearDebug(_req, res) {
  debugState.incomingRequests.length = 0;
  debugState.slowRequests.length = 0;
  debugState.openShockCalls.length = 0;
  debugState.openShockDurations.length = 0;
  for (const key of Object.keys(debugState.counters)) debugState.counters[key] = 0;
  return sendJson(res, 200, { cleared: true });
}


async function handleDiagnosticsApiKeyCheck(req, res) {
  let body = {};
  try { body = await readBody(req); } catch { body = {}; }
  const testControl = Boolean(body.control || body.testControl || body.stopPermission);
  const result = await runApiKeyPermissionCheck({ testControl });
  return sendJson(res, result.readOwnShockers?.ok || result.controlPermission?.ok ? 200 : 500, result);
}
