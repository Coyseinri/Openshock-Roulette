
const Readable = require("stream").Readable;
const baseGetHostState = getHostState;
const baseResolveHostAction = resolveHostAction;

getHostState = async function getHostStateWithSafety() {
  const snapshot = await baseGetHostState();
  return { ...snapshot, safety: safety() };
};

function getPlayerMultiplierPercentFromState(state, playerId) {
  const multipliers = state?.playerMultipliers && typeof state.playerMultipliers === "object" ? state.playerMultipliers : {};
  return clampInt(multipliers[playerId] ?? 100, 0, 100);
}

function applyManualPlayerMultiplier(value, multiplierPercent) {
  if (value <= 0) return 0;
  return Math.max(1, Math.round(value * (multiplierPercent / 100)));
}


async function resolvePublicObjectiveHostAction(req, res, body) {
  const objectiveId = String(body.objectiveId || body.id || "");
  const publicAction = String(body.actionType || body.type || "");
  if (!objectiveId) return sendJson(res, 400, { error: "Missing public objective id" });

  const state = readSessionState();
  const { shockers } = await getShockers();
  const players = await publicPlayers(shockers, state);
  let result = null;

  if (publicAction === "completePublicObjective") {
    result = completePublicObjective(state, objectiveId, players, { source: "host" });
  } else if (publicAction === "rerollPublicObjective") {
    result = rerollPublicObjective(state, objectiveId, players);
  } else {
    return sendJson(res, 400, { error: "Unsupported public objective action" });
  }

  if (!result?.ok) return sendJson(res, 400, { error: result?.error || "Could not update public objective" });
  writeSessionState(state);
  return sendJson(res, 200, { ok: true, result, state: await getHostState() });
}

async function cancelRoundModifierFromHost(req, res, body) {
  const modifierId = String(body.modifierId || body.id || "");
  if (!modifierId) return sendJson(res, 400, { error: "Missing modifier id" });

  const state = readSessionState();
  const before = Array.isArray(state.pendingRoundModifiers) ? state.pendingRoundModifiers.length : 0;
  state.pendingRoundModifiers = (state.pendingRoundModifiers || []).filter(m => String(m.id) !== modifierId);
  const cancelled = state.pendingRoundModifiers.length !== before;
  if (!cancelled) return sendJson(res, 404, { error: "Pending next-round effect not found" });

  writeDatabaseEvent({
    state,
    type: "roundModifierCancelled",
    title: "Cancelled next-round effect",
    description: `Host cancelled pending modifier ${modifierId}`,
    metadata: { modifierId }
  });
  writeSessionState(state);
  return sendJson(res, 200, { ok: true, cancelled: true, modifierId, state: await getHostState() });
}

resolveHostAction = async function resolveHostActionWithModifierCancel(req, res, url) {
  if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
  const body = await readBody(req);
  const actionType = String(body.actionType || body.type || "");
  if (actionType === "cancelRoundModifier") {
    return await cancelRoundModifierFromHost(req, res, body);
  }
  if (actionType === "completePublicObjective" || actionType === "rerollPublicObjective") {
    return await resolvePublicObjectiveHostAction(req, res, body);
  }

  const replay = new Readable();
  replay._read = () => {};
  replay.push(JSON.stringify(body || {}));
  replay.push(null);
  replay.headers = req.headers;
  replay.method = req.method;
  replay.url = req.url;
  replay.socket = req.socket;
  return await baseResolveHostAction(replay, res, url);
};

handleControl = async function handleControlWithManualMultiplier(req, res) {
  const body = await readBody(req);
  const s = safety();

  const id = String(body.id || "");
  const duration = clampInt(
    body.duration,
    s.minDurationMs ?? 300,
    s.maxDurationMs ?? 1000
  );
  const exclusive = Boolean(body.exclusive ?? true);
  const maxShock = clampInt(s.serverMaxShockIntensity ?? 99, 1, 100);

  const selectedValue = clampInt(body.selectedValue, 0, maxShock);

  if (!id) return sendJson(res, 400, { error: "Missing player or shocker id" });

  const type = selectedValue === 0 ? "Vibrate" : "Shock";
  const devices = await resolveLogicalControlDevices(id);
  if (!devices.length) return sendJson(res, 404, { error: "Unknown player or shocker id" });

  const state = body.applyPlayerMultiplier === true ? readSessionState() : null;
  const shocks = devices.map(device => {
    let multiplierPercent = null;
    let intensity = selectedValue === 0
      ? clampInt(s.serverMaxVibrateIntensity ?? 100, 1, 100)
      : selectedValue;

    if (type === "Shock" && body.applyPlayerMultiplier === true) {
      multiplierPercent = getPlayerMultiplierPercentFromState(state, device.id);
      intensity = applyManualPlayerMultiplier(selectedValue, multiplierPercent);
      intensity = clampInt(intensity, 1, maxShock);
    }

    return { id: device.id, type, intensity, duration, exclusive, selectedValue, maxShock, multiplierPercent, playerId: device.playerId, playerName: device.playerName, deviceName: device.name };
  });

  const requestBody = {
    shocks: shocks.map(({ id, type, intensity, duration, exclusive }) => ({ id, type, intensity, duration, exclusive }))
  };

  debugState.counters.shockCommands += shocks.length;
  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: type === "Vibrate" ? "vibrate" : "shock" });
  sendJson(res, result.statusCode, {
    sent: shocks.length === 1 ? shocks[0] : { id, type, selectedValue, duration, exclusive, deviceCount: shocks.length, devices: shocks },
    openshock: result.body
  });
};
