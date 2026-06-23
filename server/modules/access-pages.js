var qrDataUrlCache = new Map();

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

