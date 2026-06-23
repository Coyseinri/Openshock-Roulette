function uuid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function spendPlayerPoints(state, playerId, amount, reason = "spend", metadata = {}) {
  amount = clampInt(amount ?? 0, 0, 999999);
  state.playerPoints = state.playerPoints || {};
  const current = clampInt(state.playerPoints[playerId] ?? 0, 0, 1000000);
  if (current < amount) return false;
  state.playerPoints[playerId] = current - amount;
  writePointLedger(state, playerId, -amount, reason, metadata);
  upsertPointBalanceDatabase(playerId, state.playerPoints[playerId]);
  return true;
}

function addPlayerPoints(state, playerId, amount, reason = "award", metadata = {}) {
  amount = clampInt(amount ?? 0, 0, 999999);
  state.playerPoints = state.playerPoints || {};
  state.playerPoints[playerId] = clampInt(state.playerPoints[playerId] ?? 0, 0, 1000000) + amount;
  writePointLedger(state, playerId, amount, reason, metadata);
  upsertPointBalanceDatabase(playerId, state.playerPoints[playerId]);
}

function incrementPlayerServerStat(state, playerId, statName, amount = 1) {
  if (!playerId || !statName) return;
  state.playerStats = state.playerStats && typeof state.playerStats === "object" ? state.playerStats : {};
  const current = state.playerStats[playerId] && typeof state.playerStats[playerId] === "object" ? state.playerStats[playerId] : {};
  state.playerStats[playerId] = {
    selected: clampInt(current.selected ?? 0, 0, 1000000),
    shocked: clampInt(current.shocked ?? 0, 0, 1000000),
    vibes: clampInt(current.vibes ?? 0, 0, 1000000),
    safe: clampInt(current.safe ?? 0, 0, 1000000),
    allTargeted: clampInt(current.allTargeted ?? 0, 0, 1000000),
    totalIntensity: clampInt(current.totalIntensity ?? 0, 0, 100000000),
    bodyguards: clampInt(current.bodyguards ?? 0, 0, 1000000),
    cursesUsed: clampInt(current.cursesUsed ?? 0, 0, 1000000),
    chaosUsed: clampInt(current.chaosUsed ?? 0, 0, 1000000),
    tokensBought: clampInt(current.tokensBought ?? 0, 0, 1000000),
    lastSelectedRound: clampInt(current.lastSelectedRound ?? 0, 0, 1000000),
    lastShockedRound: clampInt(current.lastShockedRound ?? 0, 0, 1000000),
    lastVibeRound: clampInt(current.lastVibeRound ?? 0, 0, 1000000)
  };
  state.playerStats[playerId][statName] = clampInt(state.playerStats[playerId][statName] ?? 0, 0, 1000000) + clampInt(amount, 1, 999);
  upsertPlayerStatsDatabase(playerId, state.playerStats[playerId]);
}

function ensurePlayerTokenBucket(state, playerId) {
  state.playerTokens = state.playerTokens && typeof state.playerTokens === "object" ? state.playerTokens : {};
  state.playerTokens[playerId] = state.playerTokens[playerId] && typeof state.playerTokens[playerId] === "object" ? state.playerTokens[playerId] : {};
  return state.playerTokens[playerId];
}

function addPlayerToken(state, playerId, tokenType, amount = 1, reason = "award", metadata = {}) {
  tokenType = normalizeTokenType(tokenType);
  if (!tokenType) throw new Error("Invalid token type");
  const bucket = ensurePlayerTokenBucket(state, playerId);
  const delta = clampInt(amount, 1, 999);
  bucket[tokenType] = clampInt(bucket[tokenType] ?? 0, 0, 1000000) + delta;
  writeTokenLedger(state, playerId, tokenType, delta, reason, metadata);
  upsertTokenBalanceDatabase(playerId, tokenType, bucket[tokenType]);
}

function spendPlayerToken(state, playerId, tokenType, amount = 1, reason = "spend", metadata = {}) {
  tokenType = normalizeTokenType(tokenType);
  if (!tokenType) return false;
  const bucket = ensurePlayerTokenBucket(state, playerId);
  const current = clampInt(bucket[tokenType] ?? 0, 0, 1000000);
  amount = clampInt(amount, 1, 999);
  if (current < amount) return false;
  bucket[tokenType] = current - amount;
  writeTokenLedger(state, playerId, tokenType, -amount, reason, metadata);
  upsertTokenBalanceDatabase(playerId, tokenType, bucket[tokenType]);
  return true;
}

function buyPlayerToken(state, playerId, tokenType) {
  tokenType = normalizeTokenType(tokenType);
  if (!tokenType) throw new Error("Invalid token type");
  const baseCost = clampInt(economyConfig().tokenCosts[tokenType] ?? 0, 0, 999);
  const isMerchant = playerHasRole(state, playerId, "merchant");
  const cost = isMerchant ? Math.max(1, baseCost - 1) : baseCost;
  if (!spendPlayerPoints(state, playerId, cost, "token_purchase", { tokenType, baseCost, merchantDiscount: isMerchant ? 1 : 0 })) throw new Error(`${tokenType} token costs ${cost} points`);
  addPlayerToken(state, playerId, tokenType, 1, "token_purchase", { cost, baseCost, merchantDiscount: isMerchant ? 1 : 0 });
  writePurchaseLog(state, playerId, "token", tokenType, cost, { tokenType, baseCost, merchantDiscount: isMerchant ? 1 : 0 });

  // Merchant / token-shop progress must be tied to the actual purchase action.
  // This still counts when the points came from bribes, audience rewards, or host rewards,
  // because the relevant game action is spending those points in the shop.
  incrementPlayerServerStat(state, playerId, "tokensBought", 1);
  state.playerStats[playerId].tokensOwned = Math.max(clampInt(state.playerStats[playerId].tokensOwned ?? 0, 0, 1000000), totalOwnedTokens(state, playerId));

  return { tokenType, cost, baseCost, merchantDiscount: isMerchant ? 1 : 0 };
}

function queueRoundModifier(state, modifier) {
  state.pendingRoundModifiers = Array.isArray(state.pendingRoundModifiers) ? state.pendingRoundModifiers : [];
  const item = {
    id: modifier.id || uuid("mod"),
    status: "active",
    scope: modifier.scope || "nextRound",
    createdAt: new Date().toISOString(),
    ...modifier
  };
  state.pendingRoundModifiers.push(item);
  writeDatabaseEvent({ state, type: "roundModifierQueued", title: `Queued ${item.type || "modifier"}`, description: item.description || item.reason || null, actorPlayerId: item.playerId || item.bodyguardPlayerId || null, targetPlayerId: item.targetPlayerId || null, metadata: item });
  return item;
}

function queuePlayerAction(state, action) {
  state.pendingPlayerActions = Array.isArray(state.pendingPlayerActions) ? state.pendingPlayerActions : [];
  const item = {
    id: action.id || uuid("act"),
    status: "pending",
    createdAt: new Date().toISOString(),
    ...action
  };
  state.pendingPlayerActions.push(item);
  writeDatabaseEvent({ state, type: "playerActionQueued", title: `Queued ${item.type || "action"}`, actorPlayerId: item.playerId || item.bodyguardPlayerId || null, targetPlayerId: item.targetPlayerId || null, metadata: item });
  return item;
}

async function publicPlayers(existingShockers = null, existingState = null) {
  const shockers = existingShockers || (await getShockers()).shockers;
  try {
    syncKnownDevicesToDatabase(shockers, existingState || readSessionState());
  } catch (err) {
    console.warn(`WARNING: Could not update structured player/device tables: ${err.message}`);
  }
  return shockers.map(s => ({ id: s.id, name: s.name }));
}

function playerNameById(shockers = [], id, fallback = null) {
  if (!id) return fallback;
  const found = shockers.find(s => String(s.id) === String(id));
  return found?.name || fallback || "Unknown player";
}

function pendingActionView(action, shockers = []) {
  return {
    ...action,
    playerName: playerNameById(shockers, action.playerId, action.source === "audience" ? "Audience" : "Player"),
    targetName: playerNameById(shockers, action.targetPlayerId, null),
    bodyguardName: playerNameById(shockers, action.bodyguardPlayerId, null)
  };
}


function modifierView(mod, shockers = []) {
  return {
    ...mod,
    playerName: playerNameById(shockers, mod.playerId, null),
    targetName: playerNameById(shockers, mod.targetPlayerId, null),
    bodyguardName: playerNameById(shockers, mod.bodyguardPlayerId, null)
  };
}

function voteView(vote, shockers = [], state = null) {
  const ids = Array.isArray(vote.audienceSessionIds) ? vote.audienceSessionIds : [];
  const sessions = state?.audienceSessions && typeof state.audienceSessions === "object" ? state.audienceSessions : {};
  return {
    ...vote,
    targetName: playerNameById(shockers, vote.targetPlayerId, null),
    audienceCount: ids.length || (vote.count || 0),
    audienceNames: ids.map(id => sessions[id]?.displayName || id)
  };
}

function getAudienceSessionCount(state) {
  const sessions = state?.audienceSessions && typeof state.audienceSessions === "object" ? Object.values(state.audienceSessions) : [];
  const now = Date.now();
  const activeWindowMs = clampInt(audiencePageConfig().activeAudienceWindowSeconds ?? 600, 30, 86400) * 1000;
  const active = sessions.filter(s => {
    const stamp = Date.parse(s.lastSeenAt || s.lastActionAt || s.joinedAt || "");
    return Number.isFinite(stamp) && now - stamp <= activeWindowMs;
  });
  return active.length;
}

function effectiveAudienceVoteThreshold(state) {
  const configured = clampInt(economyConfig().audienceVoteThreshold ?? 1, 1, 1000000);
  const audienceCount = getAudienceSessionCount(state);
  return Math.max(1, Math.min(configured, Math.max(1, audienceCount)));
}

function buildSessionStats(state, players = []) {
  return players.map(p => ({
    id: p.id,
    name: p.name,
    points: clampInt(state.playerPoints?.[p.id] ?? 0, 0, 1000000),
    tokens: state.playerTokens?.[p.id] || {},
    stats: state.playerStats?.[p.id] || {}
  })).sort((a, b) => (b.stats.shocked || 0) - (a.stats.shocked || 0));
}

async function getHostState() {
  const state = readSessionState();
  const { shockers } = await getShockers();
  const players = await publicPlayers(shockers, state);
  return {
    roundNumber: state.roundNumber,
    updatedAt: state.updatedAt,
    players,
    economy: economyConfig(),
    hostPage: hostPageConfig(),
    audiencePage: audiencePageConfig(),
    audienceVoteThresholdEffective: effectiveAudienceVoteThreshold(state),
    audienceSessions: Object.values(state.audienceSessions || {}),
    audienceEventLog: state.audienceEventLog || [],
    hostPaused: Boolean(state.hostPaused),
    completedObjectiveEvents: state.completedObjectiveEvents || [],
    sessionStats: buildSessionStats(state, players),
    playerMultipliers: state.playerMultipliers || {},
    pendingRoundModifiers: (state.pendingRoundModifiers || []).map(m => modifierView(m, shockers)),
    audienceVotes: (state.audienceVotes || []).map(v => voteView(v, shockers, state)),
    pendingPlayerActions: (state.pendingPlayerActions || []).map(a => pendingActionView(a, shockers)).filter(a => a.status === "pending")
  };
}

