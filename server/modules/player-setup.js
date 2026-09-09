const { randomUUID } = require("node:crypto");

const PLAYER_SETUP_STATE_KEY = "playerSetup";
const PLAYER_SETUP_VERSION = 1;

function clampPercent(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(fallback)));
  return Math.max(0, Math.min(100, Math.round(n)));
}

function makePersistentPlayerId() {
  return `osr-player:${randomUUID()}`;
}

function normalizePlayerDevice(device = {}) {
  const provider = String(device.provider || "").toLowerCase() === "intiface" ? "intiface" : "openshock";
  const id = String(device.id || device.deviceId || device.shockerId || device.cacheKey || "").trim();
  return {
    provider,
    id,
    name: String(device.name || device.deviceLabel || device.displayName || id || (provider === "intiface" ? "Toy" : "Shock")).trim(),
    memberName: String(device.memberName || device.name || device.deviceLabel || device.displayName || id || "").trim(),
    enabled: device.enabled !== false,
    intensityMultiplier: clampPercent(device.intensityMultiplier ?? device.multiplier ?? 100),
    preferredTemplate: provider === "intiface" ? String(device.preferredTemplate || "soft-wave") : null,
    durationMultiplierOverride: provider === "intiface" && Number.isFinite(Number(device.durationMultiplierOverride))
      ? Math.max(0.1, Math.min(20, Number(device.durationMultiplierOverride)))
      : null,
    notes: String(device.notes || ""),
    source: String(device.source || "manual")
  };
}

function normalizeConfiguredPlayer(player = {}) {
  const id = String(player.id || makePersistentPlayerId());
  const devices = Array.isArray(player.devices)
    ? player.devices.map(normalizePlayerDevice).filter(device => device.id)
    : [];
  const dedup = new Map();
  for (const device of devices) dedup.set(`${device.provider}:${device.id}`, device);
  return {
    id,
    name: String(player.name || "Player").trim() || "Player",
    enabled: player.enabled !== false,
    devices: Array.from(dedup.values()),
    createdAt: player.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizePlayerSetup(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    version: PLAYER_SETUP_VERSION,
    initialized: raw.initialized === true,
    players: Array.isArray(raw.players) ? raw.players.map(normalizeConfiguredPlayer) : [],
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function readPlayerSetup() {
  return normalizePlayerSetup(getStateValue(PLAYER_SETUP_STATE_KEY));
}

function writePlayerSetup(setup) {
  const normalized = normalizePlayerSetup({ ...(setup || {}), initialized: true }) || {
    version: PLAYER_SETUP_VERSION,
    initialized: true,
    players: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  normalized.updatedAt = new Date().toISOString();
  setStateValue(PLAYER_SETUP_STATE_KEY, normalized);
  return normalized;
}

function playerSetupIntifaceCachePath() {
  return path.join(DATA_DIR, "intiface-device-cache.json");
}

function readPlayerSetupIntifaceCache() {
  try {
    const filePath = playerSetupIntifaceCachePath();
    if (!fs.existsSync(filePath)) return { profiles: {} };
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { profiles: raw?.profiles && typeof raw.profiles === "object" ? raw.profiles : {} };
  } catch (err) {
    console.warn(`Could not read Intiface cache for Player Setup: ${err.message}`);
    return { profiles: {} };
  }
}

function writePlayerSetupIntifaceCache(cache) {
  const normalized = { profiles: cache?.profiles && typeof cache.profiles === "object" ? cache.profiles : {} };
  const filePath = playerSetupIntifaceCachePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ...normalized, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  return normalized;
}

function replaceExactPlayerId(value, oldId, newId) {
  if (typeof value === "string") return value === oldId ? newId : value;
  if (Array.isArray(value)) return value.map(item => replaceExactPlayerId(item, oldId, newId));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = replaceExactPlayerId(item, oldId, newId);
  return out;
}

function movePlayerMapEntry(map, oldId, newId) {
  if (!map || typeof map !== "object" || oldId === newId || map[oldId] === undefined) return;
  if (map[newId] === undefined) map[newId] = map[oldId];
  delete map[oldId];
}

function migrateSessionPlayerId(state, oldId, newId) {
  if (!state || !oldId || !newId || oldId === newId) return;
  for (const key of ["playerStats", "objectiveAssignments", "playerPoints", "playerTokens", "hiddenRoles", "rolePassiveState"]) {
    movePlayerMapEntry(state[key], oldId, newId);
  }
  state.eliminatedIds = (state.eliminatedIds || []).map(id => String(id) === oldId ? newId : id);
  state.lastSelectedTargetIds = (state.lastSelectedTargetIds || []).map(id => String(id) === oldId ? newId : id);
  state.lastShockedTargetIds = (state.lastShockedTargetIds || []).map(id => String(id) === oldId ? newId : id);
  for (const key of ["pendingRoundModifiers", "pendingPlayerActions", "completedObjectiveEvents", "audienceVotes", "hostCommands"]) {
    state[key] = replaceExactPlayerId(state[key] || [], oldId, newId);
  }
  state.lastTargetPicked = replaceExactPlayerId(state.lastTargetPicked, oldId, newId);
  if (state.roleAccessKeys?.playerKeys) movePlayerMapEntry(state.roleAccessKeys.playerKeys, oldId, newId);
}

function normalizeIntifaceActuatorTypeForSetup(value, fallback = "Unknown") {
  return String(value || fallback || "Unknown").replace(/[^a-z0-9 _/-]/gi, "").trim() || "Unknown";
}

function intifaceDeviceFeaturesForSetup(device) {
  const messages = device?.DeviceMessages || {};
  const features = [];
  const scalar = messages.ScalarCmd;
  const scalarFeatures = Array.isArray(scalar) ? scalar : (Array.isArray(scalar?.Features) ? scalar.Features : []);
  scalarFeatures.forEach((feature, index) => features.push({
    command: "ScalarCmd",
    featureIndex: Number(feature.Index ?? feature.FeatureIndex ?? index),
    actuatorType: normalizeIntifaceActuatorTypeForSetup(feature.ActuatorType, "Scalar"),
    descriptor: String(feature.FeatureDescriptor || feature.Description || "")
  }));
  if (!features.length && scalar && Number.isFinite(Number(scalar.FeatureCount))) {
    for (let index = 0; index < Number(scalar.FeatureCount); index += 1) {
      features.push({ command: "ScalarCmd", featureIndex: index, actuatorType: "Scalar", descriptor: "Scalar output" });
    }
  }
  for (const [command, actuatorType] of [["VibrateCmd", "Vibrate"], ["RotateCmd", "Rotate"], ["LinearCmd", "Linear"]]) {
    if (features.some(feature => feature.command === "ScalarCmd" && feature.actuatorType.toLowerCase() === actuatorType.toLowerCase())) continue;
    const count = Number(messages?.[command]?.FeatureCount || 0);
    for (let index = 0; index < count; index += 1) features.push({ command, featureIndex: index, actuatorType, descriptor: `${actuatorType} output` });
  }
  return features.sort((a, b) => String(a.actuatorType).localeCompare(String(b.actuatorType)) || a.featureIndex - b.featureIndex);
}

function stableIntifaceFeatureKey(feature) {
  return [feature.command, feature.featureIndex, feature.actuatorType, feature.descriptor || ""].map(value => String(value ?? "").toLowerCase()).join(":");
}

function stableIntifaceDeviceKey(device) {
  const features = intifaceDeviceFeaturesForSetup(device).map(stableIntifaceFeatureKey).join("|");
  const display = String(device?.DeviceDisplayName || "").trim().toLowerCase();
  const name = String(device?.DeviceName || "").trim().toLowerCase();
  return [display, name, features].join("||");
}

function configuredToyFromCacheProfile(cacheKey, profile) {
  const settings = profile?.profile && typeof profile.profile === "object" ? profile.profile : {};
  return normalizePlayerDevice({
    provider: "intiface",
    id: cacheKey,
    name: profile?.deviceLabel || profile?.displayName || profile?.deviceDisplayName || profile?.deviceName || "Toy",
    enabled: settings.enabled !== false,
    intensityMultiplier: settings.intensityMultiplier ?? 100,
    preferredTemplate: settings.preferredTemplate || "soft-wave",
    durationMultiplierOverride: settings.durationMultiplierOverride ?? null,
    notes: settings.notes || "",
    source: "intiface-cache"
  });
}

function syncIntifaceAssignmentToStorage(cacheKey, playerId, deviceProfile = null) {
  if (!cacheKey) return;
  const state = readSessionState();
  const cache = readPlayerSetupIntifaceCache();
  if (!cache.profiles[cacheKey] && deviceProfile) {
    cache.profiles[cacheKey] = {
      cacheKey,
      deviceName: deviceProfile.name || "Toy",
      displayName: deviceProfile.name || "Toy",
      deviceLabel: deviceProfile.name || "Toy",
      playerId: "",
      featureRoles: {},
      profile: {}
    };
  }
  if (cache.profiles[cacheKey]) {
    cache.profiles[cacheKey] = {
      ...cache.profiles[cacheKey],
      playerId: playerId || "",
      assignmentSource: playerId ? "player-setup" : "",
      profile: deviceProfile ? {
        ...(cache.profiles[cacheKey].profile || {}),
        enabled: deviceProfile.enabled !== false,
        intensityMultiplier: clampPercent(deviceProfile.intensityMultiplier),
        preferredTemplate: String(deviceProfile.preferredTemplate || "soft-wave"),
        durationMultiplierOverride: deviceProfile.durationMultiplierOverride ?? null,
        notes: String(deviceProfile.notes || "")
      } : cache.profiles[cacheKey].profile,
      updatedAt: new Date().toISOString()
    };
    writePlayerSetupIntifaceCache(cache);
  }
  if (state.intiface?.mappings && typeof state.intiface.mappings === "object") {
    let changed = false;
    for (const mapping of Object.values(state.intiface.mappings)) {
      if (!mapping || typeof mapping !== "object" || String(mapping.cacheKey || "") !== cacheKey) continue;
      mapping.playerId = playerId || "";
      mapping.assignmentSource = playerId ? "player-setup" : "";
      if (deviceProfile) mapping.profile = {
        ...(mapping.profile || {}),
        enabled: deviceProfile.enabled !== false,
        intensityMultiplier: clampPercent(deviceProfile.intensityMultiplier),
        preferredTemplate: String(deviceProfile.preferredTemplate || "soft-wave"),
        durationMultiplierOverride: deviceProfile.durationMultiplierOverride ?? null,
        notes: String(deviceProfile.notes || "")
      };
      changed = true;
    }
    if (changed) writeSessionState(state);
  }
}

function migrateIntifacePlayerIds(legacyToNew) {
  const state = readSessionState();
  const cache = readPlayerSetupIntifaceCache();
  let sessionChanged = false;
  let cacheChanged = false;
  if (state.intiface?.mappings && typeof state.intiface.mappings === "object") {
    for (const mapping of Object.values(state.intiface.mappings)) {
      const mapped = legacyToNew.get(String(mapping?.playerId || ""));
      if (mapped) { mapping.playerId = mapped; sessionChanged = true; }
    }
  }
  for (const profile of Object.values(cache.profiles)) {
    const mapped = legacyToNew.get(String(profile?.playerId || ""));
    if (mapped) { profile.playerId = mapped; cacheChanged = true; }
  }
  if (sessionChanged) writeSessionState(state);
  if (cacheChanged) writePlayerSetupIntifaceCache(cache);
  return { state, cache };
}

function buildInitialPlayerSetup(shockers = []) {
  const legacyPlayers = buildLogicalPlayersFromShockers(shockers || []);
  if (!legacyPlayers.length) return null;
  const session = readSessionState();
  const legacyToNew = new Map();
  const players = legacyPlayers.map(legacy => {
    const playerId = makePersistentPlayerId();
    legacyToNew.set(String(legacy.id), playerId);
    for (const device of legacy.devices || []) legacyToNew.set(String(device.id), playerId);
    migrateSessionPlayerId(session, String(legacy.id), playerId);
    return normalizeConfiguredPlayer({
      id: playerId,
      name: legacy.name,
      enabled: true,
      devices: (legacy.devices || []).map(device => ({
        provider: "openshock",
        id: String(device.id),
        name: device.name,
        memberName: device.memberName || device.name,
        enabled: true,
        intensityMultiplier: session.playerMultipliers?.[device.id] ?? session.playerMultipliers?.[legacy.id] ?? 100,
        source: "legacy-import"
      }))
    });
  });
  writeSessionState(session);
  const { cache } = migrateIntifacePlayerIds(legacyToNew);
  for (const [cacheKey, profile] of Object.entries(cache.profiles || {})) {
    const playerId = String(profile?.playerId || "");
    const player = players.find(item => item.id === playerId);
    if (!player) continue;
    if (!player.devices.some(device => device.provider === "intiface" && device.id === cacheKey)) {
      player.devices.push(configuredToyFromCacheProfile(cacheKey, profile));
    }
  }
  return writePlayerSetup({ initialized: true, players, createdAt: new Date().toISOString() });
}

function liveIntifaceDeviceMap() {
  const map = new Map();
  try {
    if (typeof intifaceService === "undefined") return map;
    for (const device of intifaceService.snapshot()?.devices || []) map.set(stableIntifaceDeviceKey(device), device);
  } catch {}
  return map;
}

function hydrateConfiguredPlayers(setup, shockers = [], { includeDisabled = false } = {}) {
  if (!setup) return [];
  const shockerMap = new Map((shockers || []).map(shocker => [String(shocker.id), shocker]));
  const toyMap = liveIntifaceDeviceMap();
  return (setup.players || [])
    .filter(player => includeDisabled || player.enabled !== false)
    .map(player => ({
      id: player.id,
      name: player.name,
      enabled: player.enabled !== false,
      isGrouped: player.devices.filter(device => device.provider === "openshock").length > 1,
      devices: player.devices.map(device => {
        const live = device.provider === "openshock" ? shockerMap.get(device.id) : toyMap.get(device.id);
        return {
          ...device,
          name: live?.name || live?.DeviceDisplayName || live?.DeviceName || device.name,
          memberName: device.memberName || live?.name || live?.DeviceDisplayName || live?.DeviceName || device.name,
          online: Boolean(live),
          DeviceIndex: device.provider === "intiface" && live ? Number(live.DeviceIndex) : undefined
        };
      })
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function getConfiguredPlayers(existingShockers = null, options = {}) {
  let shockers = existingShockers;
  if (!Array.isArray(shockers)) {
    try { shockers = (await getShockers()).shockers || []; } catch { shockers = []; }
  }
  let setup = readPlayerSetup();
  if (!setup && shockers.length) setup = buildInitialPlayerSetup(shockers);
  if (!setup) return [];
  return hydrateConfiguredPlayers(setup, shockers, options);
}

function findConfiguredPlayerByIdSync(id) {
  const setup = readPlayerSetup();
  if (!setup) return null;
  return setup.players.find(player => String(player.id) === String(id)) || null;
}

async function resolveConfiguredPlayer(id, existingShockers = null) {
  const players = await getConfiguredPlayers(existingShockers, { includeDisabled: true });
  const direct = players.find(player => String(player.id) === String(id));
  if (direct) return direct;
  return players.find(player => player.devices.some(device => device.provider === "openshock" && String(device.id) === String(id))) || null;
}

function playerSetupSuggestionName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const grouping = shockerGroupingConfig();
  const parsed = splitGroupedShockerName(raw, grouping);
  return String(parsed.grouped ? parsed.groupName : raw).trim().toLowerCase();
}

async function getPlayerSetupState({ forceRefresh = false } = {}) {
  let shockerResult = { shockers: [], cached: false };
  let shockerError = null;
  try { shockerResult = await getShockers({ forceRefresh }); } catch (err) { shockerError = err.message; }
  let setup = readPlayerSetup();
  if (!setup && (shockerResult.shockers || []).length) setup = buildInitialPlayerSetup(shockerResult.shockers);
  const players = hydrateConfiguredPlayers(setup || { players: [] }, shockerResult.shockers || [], { includeDisabled: true });
  const assignedShock = new Set(players.flatMap(player => player.devices.filter(device => device.provider === "openshock").map(device => device.id)));
  const assignedToy = new Set(players.flatMap(player => player.devices.filter(device => device.provider === "intiface").map(device => device.id)));
  const cache = readPlayerSetupIntifaceCache();
  const liveToys = liveIntifaceDeviceMap();
  const toys = new Map();
  for (const [cacheKey, profile] of Object.entries(cache.profiles || {})) {
    toys.set(cacheKey, {
      provider: "intiface", id: cacheKey,
      name: profile.deviceLabel || profile.displayName || profile.deviceDisplayName || profile.deviceName || "Toy",
      online: liveToys.has(cacheKey), assigned: assignedToy.has(cacheKey),
      profile: profile.profile || {}
    });
  }
  for (const [cacheKey, live] of liveToys) {
    if (!toys.has(cacheKey)) toys.set(cacheKey, {
      provider: "intiface", id: cacheKey,
      name: live.DeviceDisplayName || live.DeviceName || "Toy", online: true, assigned: assignedToy.has(cacheKey), profile: {}
    });
  }
  const availableShock = (shockerResult.shockers || []).map(shocker => ({
    provider: "openshock", id: String(shocker.id), name: shocker.name, online: true, assigned: assignedShock.has(String(shocker.id))
  }));
  const availableToys = Array.from(toys.values());
  const suggestions = [];
  for (const device of [...availableShock, ...availableToys].filter(device => !device.assigned)) {
    const key = playerSetupSuggestionName(device.name);
    const player = players.find(item => playerSetupSuggestionName(item.name) === key);
    if (player) suggestions.push({ provider: device.provider, deviceId: device.id, deviceName: device.name, playerId: player.id, playerName: player.name });
  }
  const readiness = players.map(player => ({
    playerId: player.id,
    name: player.name,
    enabled: player.enabled !== false,
    ready: player.devices.some(device => device.enabled !== false && device.online),
    onlineDevices: player.devices.filter(device => device.enabled !== false && device.online).length,
    configuredDevices: player.devices.filter(device => device.enabled !== false).length
  }));
  return {
    configured: Boolean(setup?.initialized),
    players,
    devices: { shock: availableShock, toy: availableToys },
    suggestions,
    readiness,
    providers: {
      shock: { reachable: !shockerError, lastError: shockerError },
      toy: { enabled: CONFIG.intiface?.enabled === true, connected: Boolean(typeof intifaceService !== "undefined" && intifaceService.snapshot()?.ready), state: typeof intifaceService !== "undefined" ? intifaceService.snapshot()?.state : "disabled" }
    }
  };
}

function playerSetupFindDevice(setup, provider, deviceId) {
  for (const player of setup.players || []) {
    const index = player.devices.findIndex(device => device.provider === provider && device.id === deviceId);
    if (index >= 0) return { player, index, device: player.devices[index] };
  }
  return null;
}

function syncLegacyOpenShockMultiplier(device) {
  if (!device || device.provider !== "openshock") return;
  const state = readSessionState();
  state.playerMultipliers = state.playerMultipliers && typeof state.playerMultipliers === "object" ? state.playerMultipliers : {};
  state.playerMultipliers[device.id] = clampPercent(device.intensityMultiplier);
  writeSessionState(state);
}

async function applyPlayerSetupAction(body = {}) {
  const action = String(body.action || body.type || "");
  let setup = readPlayerSetup() || writePlayerSetup({ players: [] });
  if (action === "createPlayer") {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Player name is required");
    setup.players.push(normalizeConfiguredPlayer({ id: makePersistentPlayerId(), name, enabled: true, devices: [] }));
  } else if (action === "renamePlayer") {
    const player = setup.players.find(item => item.id === String(body.playerId || ""));
    if (!player) throw new Error("Player not found");
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Player name is required");
    player.name = name;
  } else if (action === "removePlayer") {
    const playerId = String(body.playerId || "");
    const player = setup.players.find(item => item.id === playerId);
    if (!player) throw new Error("Player not found");
    for (const device of player.devices.filter(device => device.provider === "intiface")) syncIntifaceAssignmentToStorage(device.id, "", device);
    setup.players = setup.players.filter(item => item.id !== playerId);
  } else if (action === "setPlayerEnabled") {
    const player = setup.players.find(item => item.id === String(body.playerId || ""));
    if (!player) throw new Error("Player not found");
    player.enabled = body.enabled !== false;
  } else if (action === "assignDevice") {
    const player = setup.players.find(item => item.id === String(body.playerId || ""));
    if (!player) throw new Error("Player not found");
    const provider = String(body.provider || "") === "intiface" ? "intiface" : "openshock";
    const deviceId = String(body.deviceId || "").trim();
    if (!deviceId) throw new Error("Device id is required");
    const existing = playerSetupFindDevice(setup, provider, deviceId);
    if (existing) existing.player.devices.splice(existing.index, 1);
    let device;
    if (provider === "intiface") {
      const cache = readPlayerSetupIntifaceCache();
      const profile = cache.profiles[deviceId] || {};
      device = configuredToyFromCacheProfile(deviceId, profile);
      if (body.deviceName && (!profile.deviceLabel && !profile.displayName)) device.name = String(body.deviceName);
      syncIntifaceAssignmentToStorage(deviceId, player.id, device);
    } else {
      const state = readSessionState();
      device = normalizePlayerDevice({ provider, id: deviceId, name: body.deviceName || deviceId, enabled: true, intensityMultiplier: state.playerMultipliers?.[deviceId] ?? 100 });
      syncLegacyOpenShockMultiplier(device);
    }
    player.devices.push(device);
  } else if (action === "unassignDevice") {
    const provider = String(body.provider || "") === "intiface" ? "intiface" : "openshock";
    const deviceId = String(body.deviceId || "");
    const existing = playerSetupFindDevice(setup, provider, deviceId);
    if (!existing) throw new Error("Device assignment not found");
    const [device] = existing.player.devices.splice(existing.index, 1);
    if (provider === "intiface") syncIntifaceAssignmentToStorage(deviceId, "", device);
  } else if (action === "updateDevice") {
    const provider = String(body.provider || "") === "intiface" ? "intiface" : "openshock";
    const deviceId = String(body.deviceId || "");
    const existing = playerSetupFindDevice(setup, provider, deviceId);
    if (!existing) throw new Error("Device assignment not found");
    existing.player.devices[existing.index] = normalizePlayerDevice({
      ...existing.device,
      enabled: body.enabled ?? existing.device.enabled,
      intensityMultiplier: body.intensityMultiplier ?? existing.device.intensityMultiplier,
      preferredTemplate: body.preferredTemplate ?? existing.device.preferredTemplate,
      durationMultiplierOverride: body.durationMultiplierOverride ?? existing.device.durationMultiplierOverride,
      notes: body.notes ?? existing.device.notes
    });
    const updated = existing.player.devices[existing.index];
    if (provider === "openshock") syncLegacyOpenShockMultiplier(updated);
    else syncIntifaceAssignmentToStorage(deviceId, existing.player.id, updated);
  } else {
    throw new Error("Unsupported Player Setup action");
  }
  setup = writePlayerSetup(setup);
  return await getPlayerSetupState({ forceRefresh: false });
}

function updateConfiguredOpenShockMultiplier(targetId, multiplierPercent) {
  const setup = readPlayerSetup();
  if (!setup) return false;
  const percent = clampPercent(multiplierPercent);
  let changed = false;
  for (const player of setup.players) {
    const directPlayerMatch = player.id === String(targetId);
    for (const device of player.devices) {
      if (device.provider !== "openshock") continue;
      if (directPlayerMatch || device.id === String(targetId)) {
        device.intensityMultiplier = percent;
        changed = true;
      }
    }
  }
  if (changed) writePlayerSetup(setup);
  return changed;
}
