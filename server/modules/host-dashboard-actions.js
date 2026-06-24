// Host dashboard action extensions.
// Loaded after OpenShock helpers and before routes.

const Readable = require("stream").Readable;
const baseResolveHostAction = resolveHostAction;

function getPlayerMultiplierPercentFromState(state, playerId) {
  const multipliers = state?.playerMultipliers && typeof state.playerMultipliers === "object" ? state.playerMultipliers : {};
  return clampInt(multipliers[playerId] ?? 100, 0, 100);
}

function applyManualPlayerMultiplier(value, multiplierPercent) {
  if (value <= 0) return 0;
  return Math.max(1, Math.round(value * (multiplierPercent / 100)));
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
  if (String(body.actionType || body.type || "") === "cancelRoundModifier") {
    return await cancelRoundModifierFromHost(req, res, body);
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

  // Game convention:
  // selectedValue 0 = Vibrate
  // selectedValue 1-serverMaxShockIntensity = Shock intensity
  const selectedValue = clampInt(body.selectedValue, 0, maxShock);

  if (!id) return sendJson(res, 400, { error: "Missing shocker id" });

  const type = selectedValue === 0 ? "Vibrate" : "Shock";
  let multiplierPercent = null;
  let intensity = selectedValue === 0
    ? clampInt(s.serverMaxVibrateIntensity ?? 100, 1, 100)
    : selectedValue;

  if (type === "Shock" && body.applyPlayerMultiplier === true) {
    const state = readSessionState();
    multiplierPercent = getPlayerMultiplierPercentFromState(state, id);
    intensity = applyManualPlayerMultiplier(selectedValue, multiplierPercent);
    intensity = clampInt(intensity, 1, maxShock);
  }

  const requestBody = {
    shocks: [{ id, type, intensity, duration, exclusive }]
  };

  debugState.counters.shockCommands += 1;
  const result = await requestOpenShock("POST", "/2/shockers/control", requestBody, { action: type === "Vibrate" ? "vibrate" : "shock" });
  sendJson(res, result.statusCode, {
    sent: { id, type, intensity, selectedValue, maxShock, multiplierPercent, duration, exclusive },
    openshock: result.body
  });
};
