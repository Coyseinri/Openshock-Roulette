var activeGameToyRuns = new Map();
var nextGameToyRunId = 1;

function gameIntifaceConfig() {
  const cfg = readConfig()?.intiface || {};
  const game = cfg.game && typeof cfg.game === "object" ? cfg.game : {};
  return {
    enabled: cfg.enabled === true,
    gameIntegrationEnabled: cfg.gameIntegrationEnabled === true,
    activationDurationMultiplier: Math.max(0.1, Math.min(20, Number(game.activationDurationMultiplier ?? 4) || 4)),
    vibeDurationMultiplier: Math.max(0.1, Math.min(20, Number(game.vibeDurationMultiplier ?? 6) || 6)),
    minDurationMs: clampInt(game.minDurationMs ?? 1000, 100, 60000),
    maxDurationMs: clampInt(game.maxDurationMs ?? 15000, 100, 120000)
  };
}

function readGameIntifaceTemplates() {
  try {
    const filePath = path.join(APP_ROOT, "config", "intiface-templates.json");
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw?.templates) ? raw.templates : [];
  } catch (err) {
    console.warn(`Could not read Intiface templates for gameplay: ${err.message}`);
    return [];
  }
}

function gameTemplateById(id) {
  const templates = readGameIntifaceTemplates();
  return templates.find(template => String(template.id) === String(id)) || templates.find(template => template.id === "soft-wave") || templates[0] || null;
}

function gameTemplateMinimumOutputs(template) {
  const match = String(template?.compatible || "").match(/(\d+)\s*\+/);
  return match ? Math.max(1, Number(match[1]) || 1) : 1;
}

function gameTemplateValue(mode, progress, position, count, maxPower) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const max = Math.max(0, Math.min(1, Number(maxPower) || 0));
  const templateMode = String(mode || "soft-wave").toLowerCase();
  if (templateMode === "steady" || templateMode === "all-steady") return max;
  if (templateMode === "ramp-up" || templateMode === "ramp") return max * p;
  if (templateMode === "tease") return max * (p % 0.25 < 0.05 ? 0.72 : 0.22);
  if (templateMode === "pulse") return (p % 0.22 < 0.1) ? max : 0;
  if (templateMode === "heartbeat") {
    const beat = p % 0.34;
    return (beat < 0.055 || (beat > 0.11 && beat < 0.17)) ? max : 0;
  }
  if (templateMode === "rollercoaster") return max * (0.15 + 0.85 * Math.abs(Math.sin(p * Math.PI * 3.5)));
  if (templateMode === "alternating") return position === Math.floor(p * Math.max(1, count) * 3) % Math.max(1, count) ? max : 0;
  if (templateMode === "random-chaos" || templateMode === "random") return Math.random() * max;
  return max * (0.2 + 0.8 * (0.5 + 0.5 * Math.sin((p * Math.PI * 2) + position)));
}

function gameFeatureRole(rawDevice, feature, cacheKey) {
  const state = readSessionState();
  const mapping = state.intiface?.mappings?.[String(rawDevice.DeviceIndex)] || {};
  const liveKey = `${rawDevice.DeviceIndex}:${feature.command}:${feature.featureIndex}:${feature.actuatorType}`;
  const liveRole = mapping.features?.[liveKey];
  if (liveRole) return String(liveRole);
  const cache = readPlayerSetupIntifaceCache();
  const cachedRole = cache.profiles?.[cacheKey]?.featureRoles?.[stableIntifaceFeatureKey(feature)];
  return String(cachedRole || "ignore");
}

function compatibleGameFeatures(rawDevice, cacheKey, template) {
  const features = intifaceDeviceFeaturesForSetup(rawDevice);
  const allowed = Array.isArray(template?.roles) && template.roles.length
    ? new Set(template.roles.map(role => String(role).toLowerCase()))
    : null;
  const active = features.filter(feature => {
    const role = gameFeatureRole(rawDevice, feature, cacheKey).toLowerCase();
    return role !== "ignore" && (!allowed || allowed.has(role));
  });
  return active.length >= gameTemplateMinimumOutputs(template) ? active : [];
}

function clampUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function gameLegacyMessage(rawDevice, feature, value) {
  const v = clampUnit(value);
  const payload = { DeviceIndex: Number(rawDevice.DeviceIndex) };
  if (feature.command === "VibrateCmd") payload.Speeds = [{ Index: Number(feature.featureIndex), Speed: v }];
  else if (feature.command === "RotateCmd") payload.Rotations = [{ Index: Number(feature.featureIndex), Speed: v, Clockwise: true }];
  else if (feature.command === "LinearCmd") payload.Vectors = [{ Index: Number(feature.featureIndex), Duration: 300, Position: v }];
  return { [feature.command]: payload };
}

function gameFeatureValueCommands(rawDevice, values) {
  const scalar = [];
  const commands = [];
  for (const item of values || []) {
    const feature = item.feature;
    if (!feature) continue;
    const value = clampUnit(item.value);
    if (feature.command === "ScalarCmd") {
      scalar.push({ Index: Number(feature.featureIndex), Scalar: value, ActuatorType: feature.actuatorType });
    } else {
      commands.push(gameLegacyMessage(rawDevice, feature, value));
    }
  }
  if (scalar.length) commands.unshift({ ScalarCmd: { DeviceIndex: Number(rawDevice.DeviceIndex), Scalars: scalar } });
  return commands;
}

function gameToyDurationMs(shockDurationMs, mode, device) {
  const cfg = gameIntifaceConfig();
  const defaultMultiplier = mode === "vibe" ? cfg.vibeDurationMultiplier : cfg.activationDurationMultiplier;
  const multiplier = Number.isFinite(Number(device.durationMultiplierOverride)) && Number(device.durationMultiplierOverride) > 0
    ? Number(device.durationMultiplierOverride)
    : defaultMultiplier;
  return clampInt(Math.round(Number(shockDurationMs || 0) * multiplier), cfg.minDurationMs, Math.max(cfg.minDurationMs, cfg.maxDurationMs));
}

function gameToyMaxPower(rolledValue, mode, device) {
  const multiplier = clampPercent(device.intensityMultiplier) / 100;
  const base = mode === "vibe" ? 1 : Math.max(0, Math.min(1, Number(rolledValue || 0) / 100));
  return clampUnit(base * multiplier);
}

function rawIntifaceDeviceForConfigured(device) {
  if (typeof intifaceService === "undefined") return null;
  const runtime = intifaceService.snapshot();
  const byIndex = Number.isFinite(Number(device.DeviceIndex))
    ? (runtime.devices || []).find(item => Number(item.DeviceIndex) === Number(device.DeviceIndex))
    : null;
  if (byIndex && stableIntifaceDeviceKey(byIndex) === device.id) return byIndex;
  return (runtime.devices || []).find(item => stableIntifaceDeviceKey(item) === device.id) || null;
}

async function stopGameToyDevice(rawDevice) {
  if (!rawDevice || typeof intifaceService === "undefined" || !intifaceService.snapshot()?.ready) return;
  try { await intifaceService.sendRaw({ StopDeviceCmd: { DeviceIndex: Number(rawDevice.DeviceIndex) } }, true); } catch {}
}

function cancelGameToyRun(cacheKey) {
  const run = activeGameToyRuns.get(cacheKey);
  if (run) run.cancelled = true;
  activeGameToyRuns.delete(cacheKey);
}

async function executeGameToyRun(run) {
  const { rawDevice, cacheKey, template, features, durationMs, maxPower } = run;
  const intervalMs = Math.max(60, Number(template.intervalMs || 180));
  const steps = Math.max(1, Math.ceil(durationMs / intervalMs));
  try {
    for (let step = 0; step <= steps; step += 1) {
      if (run.cancelled || activeGameToyRuns.get(cacheKey)?.id !== run.id) break;
      const progress = step / steps;
      const values = features.map((feature, index) => ({
        feature,
        value: gameTemplateValue(template.mode || template.id, progress, index, features.length, maxPower)
      }));
      const messages = gameFeatureValueCommands(rawDevice, values);
      if (messages.length) await intifaceService.sendRaw(messages, true);
      if (step < steps) await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  } catch (err) {
    console.warn(`[Intiface] Gameplay template failed for ${cacheKey}: ${err.message}`);
  } finally {
    const current = activeGameToyRuns.get(cacheKey);
    if (current?.id === run.id) {
      activeGameToyRuns.delete(cacheKey);
      await stopGameToyDevice(rawDevice);
    } else if (!current) {
      await stopGameToyDevice(rawDevice);
    }
  }
}

function startGameToyRun(device, { rolledValue, mode, shockDurationMs, requireGameIntegration = true, durationMsOverride = null, maxPowerPercentOverride = null, templateOverride = null }) {
  const cfg = gameIntifaceConfig();
  if (!cfg.enabled) return { ok: false, skipped: true, reason: "Intiface is disabled" };
  if (requireGameIntegration && !cfg.gameIntegrationEnabled) return { ok: false, skipped: true, reason: "Intiface game integration disabled" };
  if (typeof intifaceService === "undefined" || !intifaceService.snapshot()?.ready) return { ok: false, reason: "Intiface disconnected" };
  const rawDevice = rawIntifaceDeviceForConfigured(device);
  if (!rawDevice) return { ok: false, reason: "Toy disconnected" };
  const template = gameTemplateById(templateOverride || device.preferredTemplate || "soft-wave");
  if (!template) return { ok: false, reason: "No Intiface template available" };
  const features = compatibleGameFeatures(rawDevice, device.id, template);
  if (!features.length) return { ok: false, reason: `No active features compatible with ${template.name || template.id}` };
  const hasPowerOverride = maxPowerPercentOverride !== null && maxPowerPercentOverride !== undefined && maxPowerPercentOverride !== "" && Number.isFinite(Number(maxPowerPercentOverride));
  const hasDurationOverride = durationMsOverride !== null && durationMsOverride !== undefined && durationMsOverride !== "" && Number.isFinite(Number(durationMsOverride));
  const maxPower = hasPowerOverride
    ? clampUnit((Math.max(0, Math.min(100, Number(maxPowerPercentOverride))) / 100) * (clampPercent(device.intensityMultiplier) / 100))
    : gameToyMaxPower(rolledValue, mode, device);
  const durationMs = hasDurationOverride
    ? clampInt(durationMsOverride, 100, 120000)
    : gameToyDurationMs(shockDurationMs, mode, device);
  if (maxPower <= 0) return { ok: true, skipped: true, reason: "Device multiplier is 0%", maxPowerPercent: 0, durationMs };
  cancelGameToyRun(device.id);
  const run = {
    id: nextGameToyRunId++, cacheKey: device.id, rawDevice, template, features, maxPower, durationMs, cancelled: false
  };
  activeGameToyRuns.set(device.id, run);
  executeGameToyRun(run).catch(err => console.warn(`[Intiface] Gameplay run failed: ${err.message}`));
  return {
    ok: true,
    started: true,
    deviceId: device.id,
    deviceName: device.name,
    template: template.id,
    maxPowerPercent: Math.round(maxPower * 10000) / 100,
    durationMs,
    featureCount: features.length
  };
}

function appliedOpenShockIntensity(rolledValue, mode, device, s) {
  const multiplier = clampPercent(device.intensityMultiplier);
  if (multiplier <= 0) return 0;
  const base = mode === "vibe" ? clampInt(s.serverMaxVibrateIntensity ?? 100, 1, 100) : Math.max(0, Number(rolledValue || 0));
  if (base <= 0) return 0;
  const value = Math.round(base * (multiplier / 100));
  return mode === "vibe" ? clampInt(value, 1, 100) : clampInt(Math.max(1, value), 1, s.serverMaxShockIntensity ?? 99);
}

async function activateOpenShockDevices(player, devices, { rolledValue, mode, shockDurationMs, exclusive }) {
  if (!devices.length) return { ok: false, provider: "openshock", skipped: true, devices: [] };
  const s = safety();
  const duration = clampInt(shockDurationMs, s.minDurationMs ?? 300, s.maxDurationMs ?? 1000);
  const type = mode === "vibe" ? "Vibrate" : "Shock";
  const output = devices.map(device => ({
    device,
    intensity: appliedOpenShockIntensity(rolledValue, mode, device, s)
  }));
  const active = output.filter(item => item.device.enabled !== false && item.intensity > 0);
  if (!active.length) return { ok: true, provider: "openshock", skipped: true, devices: output.map(item => ({ id: item.device.id, intensity: item.intensity })) };
  const requestBody = { shocks: active.map(item => ({ id: item.device.id, type, intensity: item.intensity, duration, exclusive })) };
  try {
    debugState.counters.shockCommands += active.length;
    const result = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: type === "Vibrate" ? "vibrate" : "shock" });
    const ok = Number(result.statusCode) >= 200 && Number(result.statusCode) < 300;
    return {
      ok,
      provider: "openshock",
      statusCode: result.statusCode,
      devices: active.map(item => ({ id: item.device.id, name: item.device.name, type, intensity: item.intensity, duration })),
      response: result.body
    };
  } catch (err) {
    return { ok: false, provider: "openshock", error: err.message, devices: active.map(item => ({ id: item.device.id, name: item.device.name, type, intensity: item.intensity, duration })) };
  }
}

async function stopGamePlayerOutputs(player) {
  if (!player) throw new Error("Unknown player or device id");
  const result = { openshock: { ok: false, skipped: true }, intiface: [] };
  const shockDevices = (player.devices || []).filter(device => device.provider === "openshock");
  const toyDevices = (player.devices || []).filter(device => device.provider === "intiface");
  if (shockDevices.length) {
    const s = safety();
    try {
      const requestBody = { shocks: shockDevices.map(device => ({
        id: device.id, type: "Stop", intensity: 0, duration: s.minDurationMs ?? 300, exclusive: true
      })) };
      debugState.counters.stopCommands += 1;
      const response = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: "stop" });
      result.openshock = {
        ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
        statusCode: response.statusCode,
        stopped: shockDevices.length,
        response: response.body
      };
    } catch (err) {
      result.openshock = { ok: false, error: err.message, stopped: 0 };
    }
  }
  for (const device of toyDevices) {
    cancelGameToyRun(device.id);
    const rawDevice = rawIntifaceDeviceForConfigured(device);
    if (!rawDevice) {
      result.intiface.push({ ok: false, skipped: true, deviceId: device.id, reason: "Toy disconnected" });
      continue;
    }
    try {
      await stopGameToyDevice(rawDevice);
      result.intiface.push({ ok: true, deviceId: device.id, stopped: true });
    } catch (err) {
      result.intiface.push({ ok: false, deviceId: device.id, error: err.message });
    }
  }
  return result;
}

async function findConfiguredOutputDevice(provider, deviceId) {
  const players = await getConfiguredPlayers(null, { includeDisabled: true });
  for (const player of players) {
    const device = (player.devices || []).find(item => item.provider === provider && String(item.id) === String(deviceId));
    if (device) return { player, device };
  }
  return null;
}

async function testSetupDevice({ provider, deviceId, testType = "test", testValue = 10, testPower = 25, durationMs = 1500 } = {}) {
  const normalizedProvider = provider === "intiface" ? "intiface" : "openshock";
  const found = await findConfiguredOutputDevice(normalizedProvider, deviceId);
  if (!found) throw new Error("Configured device not found");
  const { player, device } = found;
  if (device.enabled === false) return { ok: false, skipped: true, reason: "Device is disabled", provider: normalizedProvider, playerId: player.id };

  if (normalizedProvider === "intiface") {
    const result = startGameToyRun(device, {
      rolledValue: Math.max(0, Math.min(100, Number(testPower) || 25)),
      mode: "normal",
      shockDurationMs: durationMs,
      requireGameIntegration: false,
      durationMsOverride: clampInt(durationMs, 500, 3000),
      maxPowerPercentOverride: Math.max(0, Math.min(100, Number(testPower) || 25))
    });
    return { ...result, provider: "intiface", playerId: player.id, playerName: player.name, test: true };
  }

  const s = safety();
  const isShock = String(testType).toLowerCase() === "shock";
  const base = isShock
    ? clampInt(testValue, 1, s.serverMaxShockIntensity ?? 99)
    : clampInt(testPower, 1, Math.min(100, s.serverMaxVibrateIntensity ?? 100));
  const intensity = Math.round(base * (clampPercent(device.intensityMultiplier) / 100));
  if (intensity <= 0) return { ok: true, skipped: true, provider: "openshock", reason: "Device multiplier is 0%", intensity: 0 };
  const safeIntensity = isShock
    ? clampInt(intensity, 1, s.serverMaxShockIntensity ?? 99)
    : clampInt(intensity, 1, Math.min(100, s.serverMaxVibrateIntensity ?? 100));
  const safeDuration = clampInt(durationMs, s.minDurationMs ?? 300, s.maxDurationMs ?? 1000);
  try {
    const response = await requestOpenShock("POST", "/2/shockers/control", {
      shocks: [{ id: device.id, type: isShock ? "Shock" : "Vibrate", intensity: safeIntensity, duration: safeDuration, exclusive: true }]
    }, { action: isShock ? "setupShockTest" : "setupVibeTest" });
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      provider: "openshock",
      playerId: player.id,
      playerName: player.name,
      test: true,
      type: isShock ? "Shock" : "Vibrate",
      intensity: safeIntensity,
      durationMs: safeDuration,
      statusCode: response.statusCode
    };
  } catch (err) {
    return { ok: false, provider: "openshock", playerId: player.id, test: true, error: err.message };
  }
}

async function stopSetupDevice({ provider, deviceId } = {}) {
  const normalizedProvider = provider === "intiface" ? "intiface" : "openshock";
  const found = await findConfiguredOutputDevice(normalizedProvider, deviceId);
  if (!found) throw new Error("Configured device not found");
  const { device } = found;
  if (normalizedProvider === "intiface") {
    cancelGameToyRun(device.id);
    const raw = rawIntifaceDeviceForConfigured(device);
    if (!raw) return { ok: false, skipped: true, reason: "Toy disconnected" };
    await stopGameToyDevice(raw);
    return { ok: true, provider: "intiface", stopped: true };
  }
  const s = safety();
  try {
    const response = await requestOpenShock("POST", "/2/shockers/control", {
      shocks: [{ id: device.id, type: "Stop", intensity: 0, duration: s.minDurationMs ?? 300, exclusive: true }]
    }, { action: "setupStop" });
    return { ok: response.statusCode >= 200 && response.statusCode < 300, provider: "openshock", stopped: true, statusCode: response.statusCode };
  } catch (err) {
    return { ok: false, provider: "openshock", error: err.message };
  }
}

async function activateGamePlayer({ playerId, rolledValue = 0, mode = null, shockDurationMs = null, exclusive = true } = {}) {
  const id = String(playerId || "");
  if (!id) throw new Error("Missing player id");
  const player = await resolveConfiguredPlayer(id);
  if (!player) throw new Error("Unknown player or device id");
  const requestedMode = String(mode || "").toLowerCase();
  if (requestedMode === "stop") {
    const providers = await stopGamePlayerOutputs(player);
    return {
      playerId: player.id,
      playerName: player.name,
      mode: "stop",
      selectedValue: 0,
      appliedValue: 0,
      providers,
      ok: Boolean(providers.openshock.ok || providers.intiface.some(item => item.ok))
    };
  }
  const s = safety();
  const selectedValue = clampInt(rolledValue, 0, s.serverMaxShockIntensity ?? 99);
  const outcomeMode = requestedMode === "vibe" || selectedValue === 0 ? "vibe" : "normal";
  const duration = clampInt(shockDurationMs ?? s.defaultDurationMs ?? 700, s.minDurationMs ?? 300, s.maxDurationMs ?? 1000);
  const enabledDevices = (player.devices || []).filter(device => device.enabled !== false);
  const shockDevices = enabledDevices.filter(device => device.provider === "openshock");
  const toyDevices = enabledDevices.filter(device => device.provider === "intiface");

  const openshock = await activateOpenShockDevices(player, shockDevices, { rolledValue: selectedValue, mode: outcomeMode, shockDurationMs: duration, exclusive });
  const intiface = toyDevices.map(device => ({ ...startGameToyRun(device, { rolledValue: selectedValue, mode: outcomeMode, shockDurationMs: duration }), provider: "intiface", deviceId: device.id, deviceName: device.name }));
  if (shockDevices.length && !openshock.ok && !openshock.skipped) {
    console.warn(`[OpenShock] Gameplay activation failed for ${player.name}: ${openshock.error || `HTTP ${openshock.statusCode || "error"}`}`);
  }
  for (const item of intiface) {
    if (!item.ok && !item.skipped) console.warn(`[Intiface] Gameplay activation failed for ${player.name}/${item.deviceName}: ${item.reason || item.error || "unknown error"}`);
  }
  const values = [
    ...(openshock.devices || []).map(device => Number(device.intensity || 0)),
    ...intiface.map(item => Number(item.maxPowerPercent || 0))
  ];
  return {
    playerId: player.id,
    playerName: player.name,
    mode: outcomeMode,
    selectedValue,
    shockDurationMs: duration,
    appliedValue: values.length ? Math.max(...values) : 0,
    providers: { openshock, intiface },
    ok: Boolean(openshock.ok || intiface.some(item => item.ok))
  };
}

handleControl = async function handleUnifiedGameControl(req, res) {
  const body = await readBody(req);
  const id = String(body.playerId || body.id || "");
  if (!id) return sendJson(res, 400, { error: "Missing player id" });
  try {
    const result = await activateGamePlayer({
      playerId: id,
      rolledValue: body.selectedValue ?? body.rolledValue ?? 0,
      mode: body.mode,
      shockDurationMs: body.duration ?? body.shockDurationMs,
      exclusive: body.exclusive !== false
    });
    return sendJson(res, 200, { ok: result.ok, sent: result, result });
  } catch (err) {
    return sendJson(res, /Unknown player/.test(err.message) ? 404 : 400, { error: err.message });
  }
};

function safeOutputDeviceStatus(device, shockReachable) {
  const provider = device.provider === "intiface" ? "intiface" : "openshock";
  const enabled = device.enabled !== false;
  const online = provider === "intiface" ? Boolean(device.online) : Boolean(shockReachable);
  return {
    provider,
    name: String(device.memberName || device.name || (provider === "intiface" ? "Toy" : "Shock")),
    enabled,
    disabled: !enabled,
    online: enabled && online,
    mappingReady: provider === "intiface" ? device.mappingReady !== false : true
  };
}

function outputStatusForPlayer(player, shockReachable) {
  const devices = (player.devices || []).map(device => safeOutputDeviceStatus(device, shockReachable));
  const providerSummary = provider => {
    const list = devices.filter(device => device.provider === provider);
    return {
      configured: list.length > 0,
      online: list.some(device => device.enabled && device.online),
      disabled: list.length > 0 && list.every(device => !device.enabled),
      count: list.length
    };
  };
  return {
    playerId: player.id,
    name: player.name,
    enabled: player.enabled !== false,
    shock: providerSummary("openshock"),
    toy: providerSummary("intiface"),
    devices
  };
}

async function getOutputStatusSnapshot(existingPlayers = null) {
  const players = Array.isArray(existingPlayers) ? existingPlayers : await getConfiguredPlayers(null, { includeDisabled: true });
  const shockConfigured = players.some(player => (player.devices || []).some(device => device.provider === "openshock"));
  const toyConfigured = players.some(player => (player.devices || []).some(device => device.provider === "intiface"));
  const shockReachable = openShockRuntimeStatus.reachable === null
    ? Boolean(shockerCache?.value && !shockerCache?.lastError && !shockerCache?.value?.warning)
    : openShockRuntimeStatus.reachable;
  const toyRuntime = typeof intifaceService !== "undefined" ? intifaceService.snapshot() : { enabled: false, ready: false };
  return {
    updatedAt: new Date().toISOString(),
    providers: {
      shock: { configured: shockConfigured, reachable: Boolean(shockReachable), lastRequestAt: openShockRuntimeStatus.lastRequestAt, lastError: openShockRuntimeStatus.lastError },
      toy: { configured: toyConfigured, enabled: toyRuntime.enabled === true, connected: toyRuntime.ready === true, state: toyRuntime.state || "disabled", deviceCount: Number(toyRuntime.connectedDeviceCount || 0) }
    },
    players: players.map(player => outputStatusForPlayer(player, shockReachable))
  };
}

async function stopAllGameOutputs(ids = []) {
  if (typeof cancelAllEventEffectRuns === "function") cancelAllEventEffectRuns("Stop All");
  for (const run of activeGameToyRuns.values()) run.cancelled = true;
  activeGameToyRuns.clear();
  const result = { openshock: { ok: true, skipped: true }, intiface: { ok: true, skipped: true } };
  const s = safety();
  let shockIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  if (!shockIds.length) {
    try {
      const players = await getConfiguredPlayers(null, { includeDisabled: true });
      shockIds = Array.from(new Set(players.flatMap(player => player.devices.filter(device => device.provider === "openshock").map(device => device.id))));
    } catch {}
  }
  if (shockIds.length) {
    try {
      const requestBody = { shocks: shockIds.map(id => ({ id, type: "Stop", intensity: 0, duration: s.minDurationMs ?? 300, exclusive: true })) };
      debugState.counters.stopCommands += 1;
      const response = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: "stop" });
      result.openshock = { ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300, statusCode: response.statusCode, stopped: shockIds.length, response: response.body };
    } catch (err) {
      result.openshock = { ok: false, error: err.message, stopped: 0 };
    }
  }
  try {
    if (typeof intifaceService !== "undefined" && intifaceService.snapshot()?.ready) {
      await intifaceService.sendRaw({ StopAllDevices: {} }, true);
      result.intiface = { ok: true, stopped: true };
    }
  } catch (err) {
    result.intiface = { ok: false, error: err.message };
  }
  return result;
}

handleStopAll = async function handleUnifiedStopAll(req, res) {
  const body = await readBody(req);
  const result = await stopAllGameOutputs(body.ids || []);
  return sendJson(res, 200, { stopped: true, ...result });
};
