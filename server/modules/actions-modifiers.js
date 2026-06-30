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
  const session = uniqueAudience ? ensureAudienceSession(state, sessionId) : { id: sessionId || "shared", displayName: displayName || "Audience" };
  if (uniqueAudience && !session) return sendJson(res, 401, { error: "Audience session expired. Enter your name again." });
  updateAudienceSessionName(state, session, displayName);
  session.lastSeenAt = new Date().toISOString();
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
  if (!session && req.method === "GET") return sendJson(res, 404, { error: "Audience session expired. Enter your name again." });
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

