var activeEventEffectRuns = new Map();
var nextEventEffectRunId = 1;

function cancelAllEventEffectRuns(reason = "cancelled") {
  for (const run of activeEventEffectRuns.values()) {
    run.cancelled = true;
    run.cancelReason = reason;
  }
  activeEventEffectRuns.clear();
}

function normalizeEventProvider(value) {
  const raw = String(value || "any").toLowerCase();
  if (["toy", "intiface"].includes(raw)) return "toy";
  if (["shock", "openshock"].includes(raw)) return "shock";
  return "any";
}

function eventPlayerHasProvider(player, provider) {
  const devices = (player.devices || []).filter(device => device.enabled !== false);
  if (provider === "toy") return devices.some(device => device.provider === "intiface" && device.online !== false);
  if (provider === "shock") return devices.some(device => device.provider === "openshock");
  return devices.some(device => device.provider === "openshock" || (device.provider === "intiface" && device.online !== false));
}

async function eligibleEventPlayers(provider = "any", excludedIds = []) {
  const normalized = normalizeEventProvider(provider);
  const state = readSessionState();
  const eliminated = new Set((state.eliminatedIds || []).map(String));
  const excluded = new Set((excludedIds || []).map(String));
  const players = await getConfiguredPlayers(null, { includeDisabled: true });
  return players.filter(player => player.enabled !== false && !eliminated.has(String(player.id)) && !excluded.has(String(player.id)) && eventPlayerHasProvider(player, normalized));
}

function scaleEventDevice(device, powerMultiplier = 1) {
  const multiplier = Math.max(0, Math.min(1, Number(powerMultiplier ?? 1) || 0));
  return { ...device, intensityMultiplier: clampPercent((Number(device.intensityMultiplier ?? 100) || 0) * multiplier) };
}

async function activateEventPlayer(player, { provider = "any", rolledValue = 0, mode = null, shockDurationMs = null, powerMultiplier = 1, durationMultiplier = 1, templateOverride = null } = {}) {
  const normalizedProvider = normalizeEventProvider(provider);
  const s = safety();
  const selectedValue = clampInt(rolledValue, 0, s.serverMaxShockIntensity ?? 99);
  const outcomeMode = String(mode || "").toLowerCase() === "vibe" || selectedValue === 0 ? "vibe" : "normal";
  const baseDuration = clampInt(shockDurationMs ?? s.defaultDurationMs ?? 700, s.minDurationMs ?? 300, s.maxDurationMs ?? 1000);
  const deviceList = (player.devices || []).filter(device => device.enabled !== false);
  const shockDevices = normalizedProvider === "toy" ? [] : deviceList.filter(device => device.provider === "openshock").map(device => scaleEventDevice(device, powerMultiplier));
  const toyDevices = normalizedProvider === "shock" ? [] : deviceList.filter(device => device.provider === "intiface").map(device => scaleEventDevice(device, powerMultiplier));

  const openshock = await activateOpenShockDevices(player, shockDevices, { rolledValue: selectedValue, mode: outcomeMode, shockDurationMs: Math.round(baseDuration * Math.max(0.1, Number(durationMultiplier) || 1)), exclusive: true });
  const cfg = gameIntifaceConfig();
  const intiface = toyDevices.map(device => {
    const normalDuration = gameToyDurationMs(baseDuration, outcomeMode, device);
    const durationMs = clampInt(Math.round(normalDuration * Math.max(0.1, Number(durationMultiplier) || 1)), cfg.minDurationMs, Math.max(cfg.minDurationMs, cfg.maxDurationMs));
    return {
      ...startGameToyRun(device, {
        rolledValue: selectedValue,
        mode: outcomeMode,
        shockDurationMs: baseDuration,
        requireGameIntegration: true,
        durationMsOverride: durationMs,
        templateOverride
      }),
      provider: "intiface",
      deviceName: device.name
    };
  });
  return {
    playerId: player.id,
    playerName: player.name,
    provider: normalizedProvider,
    openshock,
    intiface,
    ok: Boolean(openshock.ok || intiface.some(item => item.ok))
  };
}

function pickRandomPlayers(players, effect) {
  const source = players.slice();
  const percent = Number(effect.percentage ?? effect.percent ?? 0);
  let count = Number(effect.count ?? 0);
  if (percent > 0) count = Math.ceil(source.length * Math.max(0, Math.min(100, percent)) / 100);
  if (!Number.isFinite(count) || count <= 0) count = 1;
  count = Math.min(source.length, Math.max(1, Math.round(count)));
  const picked = [];
  while (source.length && picked.length < count) {
    const index = Math.floor(Math.random() * source.length);
    picked.push(source.splice(index, 1)[0]);
  }
  return picked;
}

function delayEventRun(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function executeEventSequence(run) {
  try {
    for (let i = 0; i < run.players.length; i += 1) {
      if (run.cancelled || activeEventEffectRuns.get(run.id) !== run) break;
      const result = await activateEventPlayer(run.players[i], run.options);
      run.results.push(result);
      if (!result.ok) break;
      if (i < run.players.length - 1) await delayEventRun(run.delayMs);
    }
  } catch (err) {
    run.error = err.message;
  } finally {
    if (activeEventEffectRuns.get(run.id) === run) activeEventEffectRuns.delete(run.id);
  }
}

async function startEventSequence(effect, context) {
  const provider = normalizeEventProvider(effect.provider || context.provider || "any");
  const exclusions = [
    ...(Array.isArray(effect.excludePlayerIds) ? effect.excludePlayerIds : []),
    ...(effect.excludeTargets === true ? (context.targetPlayerIds || []) : [])
  ];
  const candidates = await eligibleEventPlayers(provider, exclusions);
  if (!candidates.length) return { ok: true, skipped: true, reason: `No eligible ${provider} players` };
  const allowRepeat = effect.allowRepeat === true;
  let count = Math.max(1, Math.round(Number(effect.count || candidates.length)));
  const ordered = [];
  if (allowRepeat) {
    for (let i = 0; i < count; i += 1) ordered.push(candidates[Math.floor(Math.random() * candidates.length)]);
  } else {
    const shuffled = pickRandomPlayers(candidates, { count: Math.min(count, candidates.length) });
    ordered.push(...shuffled);
  }
  const shockDurationMs = Number(context.shockDurationMs || 700);
  const requestedDelay = Math.max(0, Number(effect.delayMs ?? 1200));
  const delayMs = provider === "shock" ? Math.max(requestedDelay, shockDurationMs + 500) : Math.max(250, requestedDelay);
  const id = `event-run-${nextEventEffectRunId++}`;
  const run = {
    id,
    cancelled: false,
    players: ordered,
    delayMs,
    results: [],
    options: {
      provider,
      rolledValue: context.rolledValue,
      mode: effect.mode || context.mode,
      shockDurationMs,
      powerMultiplier: Number(effect.powerMultiplier ?? context.powerMultiplier ?? 1),
      durationMultiplier: Number(effect.durationMultiplier ?? context.durationMultiplier ?? 1),
      templateOverride: effect.templateOverride || context.templateOverride || null
    }
  };
  activeEventEffectRuns.set(id, run);
  executeEventSequence(run).catch(err => console.warn(`[Events] Sequence ${id} failed: ${err.message}`));
  return { ok: true, started: true, runId: id, provider, playerCount: ordered.length, delayMs };
}

async function executeEventActivationEffect(effect, context) {
  const type = String(effect.type || "");
  if (type === "sequencePlayers") return startEventSequence(effect, context);

  let provider = "any";
  let players = [];
  const targetIds = (context.targetPlayerIds || []).map(String);
  if (type === "activateTargetToys") provider = "toy";
  if (type === "activateTargetShocks") provider = "shock";
  if (type === "activateAllToys" || type === "activateOtherToys" || type === "activateRandomToyPlayers") provider = "toy";
  if (type === "activateRandomShockPlayers") provider = "shock";

  const excludedIds = (type === "activateOtherToys" || effect.excludeTargets === true) ? targetIds : [];
  const all = await eligibleEventPlayers(provider, excludedIds);
  if (["activateTargetDevices", "activateTargetToys", "activateTargetShocks"].includes(type)) players = all.filter(player => targetIds.includes(String(player.id)));
  else if (["activateRandomToyPlayers", "activateRandomShockPlayers"].includes(type)) players = pickRandomPlayers(all, effect);
  else players = all;

  if (!players.length) return { ok: true, skipped: true, reason: "No eligible players", type };
  const results = [];
  for (const player of players) {
    results.push(await activateEventPlayer(player, {
      provider,
      rolledValue: context.rolledValue,
      mode: effect.mode || context.mode,
      shockDurationMs: context.shockDurationMs,
      powerMultiplier: Number(effect.powerMultiplier ?? context.powerMultiplier ?? 1),
      durationMultiplier: Number(effect.durationMultiplier ?? context.durationMultiplier ?? 1),
      templateOverride: effect.templateOverride || context.templateOverride || null
    }));
  }
  return { ok: results.some(result => result.ok), type, provider, results };
}

function validateEventDeviceEffect(raw) {
  const effect = raw && typeof raw === "object" ? { ...raw } : {};
  const type = String(effect.type || "");
  const allowed = new Set([
    "activateTargetDevices", "activateTargetToys", "activateTargetShocks", "activateAllToys", "activateOtherToys",
    "activateRandomToyPlayers", "activateRandomShockPlayers", "sequencePlayers", "devicePowerModifier", "deviceDurationModifier", "toyTemplateOverride"
  ]);
  if (!allowed.has(type)) throw new Error(`Unsupported device-aware event effect '${type || "missing"}'`);

  if (effect.powerMultiplier !== undefined) {
    const power = Number(effect.powerMultiplier);
    if (!Number.isFinite(power) || power < 0 || power > 1) throw new Error(`${type}.powerMultiplier must be between 0 and 1`);
    effect.powerMultiplier = power;
  }
  if (effect.durationMultiplier !== undefined) {
    const duration = Number(effect.durationMultiplier);
    if (!Number.isFinite(duration) || duration < 0.1 || duration > 5) throw new Error(`${type}.durationMultiplier must be between 0.1 and 5`);
    effect.durationMultiplier = duration;
  }
  if (["activateRandomToyPlayers", "activateRandomShockPlayers"].includes(type) && effect.count !== undefined) {
    const count = Number(effect.count);
    if (!Number.isFinite(count) || count < 1 || count > 50) throw new Error(`${type}.count must be between 1 and 50`);
    effect.count = Math.round(count);
  }
  if (type === "sequencePlayers") {
    const provider = String(effect.provider || "any").toLowerCase();
    if (!["any", "toy", "shock"].includes(provider)) throw new Error("sequencePlayers.provider must be any, toy, or shock");
    effect.provider = provider;
    const count = Number(effect.count ?? 1);
    if (!Number.isFinite(count) || count < 1 || count > 50) throw new Error("sequencePlayers.count must be between 1 and 50");
    effect.count = Math.round(count);
    const delayMs = Number(effect.delayMs ?? 1200);
    if (!Number.isFinite(delayMs) || delayMs < 250 || delayMs > 60000) throw new Error("sequencePlayers.delayMs must be between 250 and 60000");
    effect.delayMs = Math.round(delayMs);
    effect.allowRepeat = effect.allowRepeat === true;
  }
  if (type === "devicePowerModifier") {
    const multiplier = Number(effect.multiplier ?? effect.value);
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1) throw new Error("devicePowerModifier.multiplier must be between 0 and 1");
    effect.multiplier = multiplier;
  }
  if (type === "deviceDurationModifier") {
    const multiplier = Number(effect.multiplier ?? effect.value);
    if (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 5) throw new Error("deviceDurationModifier.multiplier must be between 0.1 and 5");
    effect.multiplier = multiplier;
  }
  if (type === "toyTemplateOverride") {
    const templateId = String(effect.templateId || effect.template || effect.value || "").trim();
    const templates = readGameIntifaceTemplates();
    if (!templateId || !templates.some(template => String(template.id) === templateId)) throw new Error(`Unknown Toy template '${templateId || "missing"}'`);
    effect.templateId = templateId;
  }
  return effect;
}

async function runEventDeviceEffects({ effects = [], targetPlayerIds = [], rolledValue = 0, mode = null, shockDurationMs = 700 } = {}) {
  const context = { targetPlayerIds, rolledValue, mode, shockDurationMs, powerMultiplier: 1, durationMultiplier: 1, templateOverride: null };
  const results = [];
  for (const raw of Array.isArray(effects) ? effects : []) {
    const effect = validateEventDeviceEffect(raw);
    const type = effect.type;
    if (type === "devicePowerModifier") { context.powerMultiplier *= effect.multiplier; continue; }
    if (type === "deviceDurationModifier") { context.durationMultiplier *= effect.multiplier; continue; }
    if (type === "toyTemplateOverride") { context.templateOverride = effect.templateId; continue; }
    results.push(await executeEventActivationEffect(effect, context));
  }
  return { ok: true, results };
}
