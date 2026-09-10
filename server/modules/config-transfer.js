var configTransferCrypto = require("node:crypto");
var CONFIG_TRANSFER_FORMAT = "openshock-roulette-config";
var CONFIG_TRANSFER_SCHEMA_VERSION = 1;
var CONFIG_TRANSFER_SCOPES = ["players", "deviceMappings", "gameProfile"];
var CONFIG_TRANSFER_MAX_BYTES = 1024 * 1024;
var CONFIG_TRANSFER_TOKEN_TTL_MS = 10 * 60 * 1000;
var CONFIG_TRANSFER_BACKUP_DIR = path.join(DATA_DIR, "config-import-backups");
var configTransferPlans = new Map();

function cloneConfigTransfer(value) { return JSON.parse(JSON.stringify(value)); }
function isConfigTransferObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function assertSafeConfigTransferValue(value, depth = 0) {
  if (depth > 12) throw new Error("Import document is nested too deeply");
  if (typeof value === "string" && value.length > 10000) throw new Error("Import document contains an oversized value");
  if (typeof value === "string" && (/^(?:[a-z]:[\\/]|\/)/i.test(value) || /^https?:\/\//i.test(value))) throw new Error("Absolute paths and external references are not allowed in imports");
  if (!value || typeof value !== "object") return;
  if (Object.keys(value).length > 1000) throw new Error("Import document contains too many fields");
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Unsafe field rejected: ${key}`);
    if (/(?:api.?key|password|secret|authorization|access.?token|token)$/i.test(key) || /(?:path|url)$/i.test(key)) throw new Error(`Sensitive or machine-specific field rejected: ${key}`);
    assertSafeConfigTransferValue(value[key], depth + 1);
  }
}
function normalizeConfigTransferScopes(scopes) {
  const requested = Array.isArray(scopes) && scopes.length ? scopes : CONFIG_TRANSFER_SCOPES;
  const result = [...new Set(requested.map(String))];
  if (!result.length || result.some(scope => !CONFIG_TRANSFER_SCOPES.includes(scope))) throw new Error("Unknown or empty export scope");
  return result;
}
function exportedPlayerDevice(device) {
  const toy = device.provider === "intiface";
  return {
    provider: toy ? "intiface" : "openshock", id: String(device.id || ""), name: String(device.name || ""),
    memberName: String(device.memberName || ""), enabled: device.enabled !== false,
    intensityMultiplier: clampPercent(device.intensityMultiplier),
    preferredTemplate: toy ? String(device.preferredTemplate || "soft-wave") : null,
    durationMultiplierOverride: toy ? (device.durationMultiplierOverride ?? null) : null,
    notes: toy ? String(device.notes || "").slice(0, 1000) : ""
  };
}
function exportedGameProfile() {
  const disk = configForDisk(readConfig());
  const profile = {};
  for (const key of ["safety", "keyboard", "spinners", "game", "events", "pages", "economy", "ui"]) profile[key] = cloneConfigTransfer(disk[key] || {});
  profile.devices = { shockers: cloneConfigTransfer(disk.devices?.shockers || {}) };
  const intiface = cloneConfigTransfer(disk.intiface || {});
  for (const key of ["websocketUrl", "cacheFile", "templateLibraryPath", "capabilityDatabasePath", "executablePath", "workingDirectory"]) delete intiface[key];
  profile.intiface = intiface;
  return profile;
}
function buildConfigTransferExport(scopesInput) {
  const scopes = normalizeConfigTransferScopes(scopesInput);
  const setup = readPlayerSetup() || { initialized: false, players: [] };
  const data = {};
  if (scopes.includes("players")) data.players = {
    version: PLAYER_SETUP_VERSION, initialized: setup.initialized === true,
    players: setup.players.map(player => ({ id: player.id, name: player.name, enabled: player.enabled !== false, createdAt: player.createdAt || null }))
  };
  if (scopes.includes("deviceMappings")) {
    const profiles = readPlayerSetupIntifaceCache().profiles || {};
    data.deviceMappings = {
      assignments: setup.players.flatMap(player => player.devices.map(device => ({ playerId: player.id, device: exportedPlayerDevice(device) }))),
      intifaceProfiles: Object.entries(profiles).map(([cacheKey, raw]) => ({
        cacheKey, deviceName: String(raw.deviceName || ""), displayName: String(raw.displayName || ""),
        deviceLabel: String(raw.deviceLabel || ""), featureRoles: isConfigTransferObject(raw.featureRoles) ? cloneConfigTransfer(raw.featureRoles) : {},
        profile: exportedPlayerDevice({ provider: "intiface", id: cacheKey, ...(raw.profile || {}) })
      }))
    };
  }
  if (scopes.includes("gameProfile")) data.gameProfile = exportedGameProfile();
  return { format: CONFIG_TRANSFER_FORMAT, schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION, exportedAt: new Date().toISOString(), applicationVersion: APP_VERSION, scopes, data };
}
function validateImportedPlayers(raw) {
  if (!isConfigTransferObject(raw) || !Array.isArray(raw.players) || raw.players.length > 200) throw new Error("Invalid players scope");
  const ids = new Set();
  return raw.players.map(item => {
    const id = String(item?.id || "").trim(), name = String(item?.name || "").trim();
    if (!id || id.length > 200 || !name || name.length > 100 || ids.has(id)) throw new Error("Players require unique stable IDs and names");
    ids.add(id);
    return { id, name, enabled: item.enabled !== false, devices: [], createdAt: item.createdAt || new Date().toISOString() };
  });
}
function validateImportedMappings(raw) {
  if (!isConfigTransferObject(raw) || !Array.isArray(raw.assignments) || !Array.isArray(raw.intifaceProfiles)) throw new Error("Invalid deviceMappings scope");
  if (raw.assignments.length > 1000 || raw.intifaceProfiles.length > 500) throw new Error("Too many device mappings");
  const seen = new Set();
  const assignments = raw.assignments.map(item => {
    const playerId = String(item?.playerId || "").trim(), device = normalizePlayerDevice(item?.device || {});
    const key = `${device.provider}:${device.id}`;
    if (!playerId || !device.id || seen.has(key)) throw new Error("Mappings require a player, unique provider and stable device ID");
    seen.add(key); return { playerId, device };
  });
  const profiles = {};
  for (const item of raw.intifaceProfiles) {
    const cacheKey = String(item?.cacheKey || "").trim();
    if (!cacheKey || profiles[cacheKey]) throw new Error("Intiface profiles require unique stable keys");
    profiles[cacheKey] = {
      cacheKey, deviceName: String(item.deviceName || ""), displayName: String(item.displayName || ""), deviceLabel: String(item.deviceLabel || ""),
      featureRoles: isConfigTransferObject(item.featureRoles) ? cloneConfigTransfer(item.featureRoles) : {},
      profile: exportedPlayerDevice({ provider: "intiface", id: cacheKey, ...(item.profile || {}) })
    };
  }
  return { assignments, profiles };
}
function mergePlayerScope(current, imported, mode) {
  const currentById = new Map(current.map(player => [player.id, cloneConfigTransfer(player)]));
  const result = mode === "replace" ? [] : current.map(cloneConfigTransfer);
  const positions = new Map(result.map((player, index) => [player.id, index]));
  for (const incoming of imported) {
    const next = { ...incoming, devices: currentById.get(incoming.id)?.devices || [] };
    if (positions.has(incoming.id)) result[positions.get(incoming.id)] = next;
    else { positions.set(incoming.id, result.length); result.push(next); }
  }
  return result;
}
function mergeMappingScope(players, mappingData, mode) {
  const result = players.map(player => ({ ...player, devices: mode === "replace" ? [] : (player.devices || []).map(cloneConfigTransfer) }));
  const byId = new Map(result.map(player => [player.id, player])), unresolved = [];
  const knownToyProfiles = new Set([...Object.keys(readPlayerSetupIntifaceCache().profiles || {}), ...Object.keys(mappingData.profiles)]);
  for (const assignment of mappingData.assignments) {
    const target = byId.get(assignment.playerId);
    if (!target) { unresolved.push({ type: "missingPlayer", playerId: assignment.playerId, deviceId: assignment.device.id }); continue; }
    if (assignment.device.provider === "intiface" && !knownToyProfiles.has(assignment.device.id)) {
      unresolved.push({ type: "missingDeviceProfile", playerId: assignment.playerId, deviceId: assignment.device.id }); continue;
    }
    for (const player of result) player.devices = player.devices.filter(device => `${device.provider}:${device.id}` !== `${assignment.device.provider}:${assignment.device.id}`);
    target.devices.push(assignment.device);
  }
  return { players: result, unresolved };
}
function configTransferCounts(before, after, keyFn) {
  const oldMap = new Map(before.map(item => [keyFn(item), JSON.stringify(item)])), newMap = new Map(after.map(item => [keyFn(item), JSON.stringify(item)]));
  let add = 0, update = 0, remove = 0, unchanged = 0;
  for (const [key, value] of newMap) { if (!oldMap.has(key)) add++; else if (oldMap.get(key) === value) unchanged++; else update++; }
  for (const key of oldMap.keys()) if (!newMap.has(key)) remove++;
  return { add, update, remove, unchanged };
}
function createConfigTransferPlan(document, modeInput) {
  if (Buffer.byteLength(JSON.stringify(document || {}), "utf8") > CONFIG_TRANSFER_MAX_BYTES) throw new Error("Import document exceeds 1 MiB");
  assertSafeConfigTransferValue(document);
  if (!isConfigTransferObject(document) || document.format !== CONFIG_TRANSFER_FORMAT || document.schemaVersion !== CONFIG_TRANSFER_SCHEMA_VERSION) throw new Error("Unsupported config export format or schema version");
  const scopes = normalizeConfigTransferScopes(document.scopes);
  if (!isConfigTransferObject(document.data)) throw new Error("Import data is missing");
  for (const scope of scopes) if (!Object.prototype.hasOwnProperty.call(document.data, scope)) throw new Error(`Missing selected scope: ${scope}`);
  const mode = modeInput === "replace" ? "replace" : "merge", currentSetup = readPlayerSetup() || { initialized: false, players: [] };
  let players = currentSetup.players.map(cloneConfigTransfer);
  if (scopes.includes("players")) players = mergePlayerScope(players, validateImportedPlayers(document.data.players), mode);
  let mappingData = null, unresolved = [];
  if (scopes.includes("deviceMappings")) { mappingData = validateImportedMappings(document.data.deviceMappings); const merged = mergeMappingScope(players, mappingData, mode); players = merged.players; unresolved = merged.unresolved; }
  let diskConfig = configForDisk(readConfig());
  if (scopes.includes("gameProfile")) {
    if (!isConfigTransferObject(document.data.gameProfile)) throw new Error("Invalid gameProfile scope");
    const incoming = document.data.gameProfile, candidate = cloneConfigTransfer(diskConfig);
    for (const key of Object.keys(exportedGameProfile())) if (Object.prototype.hasOwnProperty.call(incoming, key)) candidate[key] = cloneConfigTransfer(incoming[key]);
    candidate.server = diskConfig.server; candidate.api = diskConfig.api;
    if (candidate.intiface) for (const key of ["websocketUrl", "cacheFile", "templateLibraryPath", "capabilityDatabasePath", "executablePath", "workingDirectory"]) if (diskConfig.intiface?.[key] !== undefined) candidate.intiface[key] = diskConfig.intiface[key];
    diskConfig = configForDisk(validateConfig(normalizeConfigForRuntime(candidate)));
  }
  const oldDevices = currentSetup.players.flatMap(player => player.devices.map(device => ({ playerId: player.id, ...device })));
  const newDevices = players.flatMap(player => player.devices.map(device => ({ playerId: player.id, ...device })));
  const diff = {
    players: configTransferCounts(currentSetup.players, players, item => item.id),
    deviceMappings: configTransferCounts(oldDevices, newDevices, item => `${item.provider}:${item.id}`),
    gameProfile: { changed: scopes.includes("gameProfile") && JSON.stringify(configForDisk(readConfig())) !== JSON.stringify(diskConfig) },
    unresolved
  };
  const warnings = [];
  if (mode === "replace") warnings.push("Replace removes entries in selected scopes that are absent from the import.");
  if (scopes.includes("gameProfile")) warnings.push("Review safety limits and device power settings before applying.");
  if (unresolved.length) warnings.push(`${unresolved.length} mapping(s) reference missing players and will be skipped.`);
  return { scopes, mode, players, mappingData, diskConfig, diff, warnings };
}
function previewConfigTransferImport(document, mode) {
  const plan = createConfigTransferPlan(document, mode), validationId = configTransferCrypto.randomUUID();
  const fingerprint = configTransferCrypto.createHash("sha256").update(JSON.stringify({
    setup: readPlayerSetup(), cache: readPlayerSetupIntifaceCache(), config: configForDisk(readConfig())
  })).digest("hex");
  configTransferPlans.set(validationId, { createdAt: Date.now(), fingerprint, plan });
  for (const [id, entry] of configTransferPlans) if (Date.now() - entry.createdAt > CONFIG_TRANSFER_TOKEN_TTL_MS) configTransferPlans.delete(id);
  return { validationId, expiresInSeconds: CONFIG_TRANSFER_TOKEN_TTL_MS / 1000, scopes: plan.scopes, mode: plan.mode, diff: plan.diff, warnings: plan.warnings };
}
function configTransferFileSnapshot(filePath) { return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null; }
function restoreConfigTransferFile(filePath, contents) {
  if (contents === null) { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
  else { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, contents); }
}
function writeConfigTransferBackup() {
  fs.mkdirSync(CONFIG_TRANSFER_BACKUP_DIR, { recursive: true });
  const filePath = path.join(CONFIG_TRANSFER_BACKUP_DIR, `config-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(filePath, JSON.stringify(buildConfigTransferExport(CONFIG_TRANSFER_SCOPES), null, 2), "utf8");
  const files = fs.readdirSync(CONFIG_TRANSFER_BACKUP_DIR).filter(name => name.startsWith("config-import-") && name.endsWith(".json")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 10))) fs.unlinkSync(path.join(CONFIG_TRANSFER_BACKUP_DIR, old));
  return filePath;
}
function applyConfigTransferImport(validationId) {
  const entry = configTransferPlans.get(String(validationId || ""));
  if (!entry || Date.now() - entry.createdAt > CONFIG_TRANSFER_TOKEN_TTL_MS) throw new Error("Import preview expired; validate the file again");
  configTransferPlans.delete(String(validationId));
  const currentFingerprint = configTransferCrypto.createHash("sha256").update(JSON.stringify({
    setup: readPlayerSetup(), cache: readPlayerSetupIntifaceCache(), config: configForDisk(readConfig())
  })).digest("hex");
  if (currentFingerprint !== entry.fingerprint) throw new Error("Configuration changed after preview; validate the import again");
  const plan = entry.plan, cachePath = playerSetupIntifaceCachePath();
  const snapshot = { config: configTransferFileSnapshot(CONFIG_PATH), cache: configTransferFileSnapshot(cachePath), setup: cloneConfigTransfer(getStateValue(PLAYER_SETUP_STATE_KEY)) };
  const backupPath = writeConfigTransferBackup();
  try {
    if (plan.scopes.includes("gameProfile")) { writeConfig(plan.diskConfig); CONFIG = readConfig(); }
    if (plan.scopes.includes("players") || plan.scopes.includes("deviceMappings")) writePlayerSetup({ initialized: true, players: plan.players });
    if (plan.scopes.includes("deviceMappings")) {
      const profiles = plan.mode === "replace" ? {} : cloneConfigTransfer(readPlayerSetupIntifaceCache().profiles || {});
      Object.assign(profiles, plan.mappingData.profiles);
      const assigned = new Map(plan.players.flatMap(player => player.devices.filter(device => device.provider === "intiface").map(device => [device.id, player.id])));
      for (const [cacheKey, profile] of Object.entries(profiles)) profile.playerId = assigned.get(cacheKey) || "";
      writePlayerSetupIntifaceCache({ profiles });
    }
  } catch (err) {
    restoreConfigTransferFile(CONFIG_PATH, snapshot.config); restoreConfigTransferFile(cachePath, snapshot.cache);
    setStateValue(PLAYER_SETUP_STATE_KEY, snapshot.setup); invalidateConfigCache(); CONFIG = readConfig();
    throw new Error(`Import failed and was rolled back: ${err.message}`);
  }
  return { ok: true, backup: path.basename(backupPath), scopes: plan.scopes, mode: plan.mode, diff: plan.diff, warnings: plan.warnings };
}
