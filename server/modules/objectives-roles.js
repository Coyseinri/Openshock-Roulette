function readObjectives() {
  return readObjectivesFileNormalized();
}

function statValueForObjective(stats, objective, state) {
  stats = stats || {};
  switch (objective.type) {
    case "selected": return clampInt(stats.selected ?? 0, 0, 1000000);
    case "shocked": return clampInt(stats.shocked ?? 0, 0, 1000000);
    case "vibes": return clampInt(stats.vibes ?? 0, 0, 1000000);
    case "safe": return clampInt(stats.safe ?? 0, 0, 1000000);
    case "allTargeted": return clampInt(stats.allTargeted ?? 0, 0, 1000000);
    case "totalIntensity": return clampInt(stats.totalIntensity ?? 0, 0, 100000000);
    case "bodyguards": return clampInt(stats.bodyguards ?? 0, 0, 1000000);
    case "cursesUsed": return clampInt(stats.cursesUsed ?? 0, 0, 1000000);
    case "chaosUsed": return clampInt(stats.chaosUsed ?? 0, 0, 1000000);
    case "tokensBought": return clampInt(stats.tokensBought ?? 0, 0, 1000000);
    case "roundsSinceSelected": return stats.lastSelectedRound ? Math.max(0, clampInt(state.roundNumber ?? 0, 0, 1000000) - clampInt(stats.lastSelectedRound, 0, 1000000)) : 0;
    case "roundsSinceShocked": return stats.lastShockedRound ? Math.max(0, clampInt(state.roundNumber ?? 0, 0, 1000000) - clampInt(stats.lastShockedRound, 0, 1000000)) : 0;
    default: return clampInt(stats[objective.type] ?? 0, 0, 100000000);
  }
}

var CUMULATIVE_OBJECTIVE_TYPES = new Set(["selected", "shocked", "vibes", "safe", "allTargeted", "totalIntensity", "bodyguards", "cursesUsed", "chaosUsed", "tokensBought", "tokensOwned", "highPlusSurvived", "eventCardsExperienced", "sabotageEffects", "redirectedHits"]);

var DEFAULT_PUBLIC_OBJECTIVES = [
  { id: "public-survive-3-rounds", title: "Still Standing", description: "The group survives 3 rounds together.", type: "rounds", target: 3, reward: { points: 1 }, enabled: true },
  { id: "public-use-3-shields", title: "Safety First", description: "Use 3 shields as a group.", type: "bodyguards", target: 3, reward: { points: 2 }, enabled: true },
  { id: "public-audience-5-votes", title: "Mob Rule", description: "Audience gets 5 votes approved.", type: "audienceVotesApproved", target: 5, reward: { points: 2 }, enabled: true },
  { id: "public-shock-all-once", title: "Everybody Gets One", description: "Shock all active players once.", type: "allTargeted", target: 1, reward: { points: 2 }, enabled: true }
];

function objectiveBaselineValue(stats, objective, state) {
  return CUMULATIVE_OBJECTIVE_TYPES.has(String(objective?.type || ""))
    ? statValueForObjective(stats, objective, state)
    : 0;
}

function objectiveProgressValue(stats, objective, state, assignment = {}) {
  const current = statValueForObjective(stats, objective, state);
  if (!CUMULATIVE_OBJECTIVE_TYPES.has(String(objective?.type || ""))) return current;
  return Math.max(0, current - clampInt(assignment.baseline ?? 0, 0, 100000000));
}

function makeObjectiveAssignment(def, stats, state) {
  return {
    objectiveId: def.id,
    assignedAt: new Date().toISOString(),
    baseline: objectiveBaselineValue(stats, def, state),
    progress: 0,
    target: def.target,
    completed: false,
    rewardClaimed: false
  };
}

function objectiveById(id) {
  return readObjectives().objectives.find(o => o.id === id) || null;
}

function getHiddenRoleDefs() {
  return readObjectivesFileNormalized().hiddenRoles || [];
}

function hiddenRoleById(id) {
  return getHiddenRoleDefs().find(r => r.id === id) || null;
}

function readObjectiveCatalogRaw() {
  try {
    ensureLocalFilesFromExamples();
    const source = fs.existsSync(OBJECTIVES_PATH || "") ? OBJECTIVES_PATH : OBJECTIVES_EXAMPLE_PATH;
    return source && fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, "utf8")) : {};
  } catch (err) {
    console.warn(`WARNING: Could not read public objectives: ${err.message}`);
    return {};
  }
}

function getPublicObjectiveDefs() {
  const raw = readObjectiveCatalogRaw();
  const publicObjectives = Array.isArray(raw.publicObjectives) && raw.publicObjectives.length ? raw.publicObjectives : DEFAULT_PUBLIC_OBJECTIVES;
  return publicObjectives
    .filter(o => o && o.enabled !== false && o.id && o.type && clampInt(o.target ?? 0, 0, 1000000) > 0)
    .map(o => ({
      ...o,
      id: String(o.id),
      type: String(o.type),
      target: clampInt(o.target ?? 0, 1, 1000000)
    }));
}

function publicObjectiveById(id) {
  return getPublicObjectiveDefs().find(o => String(o.id) === String(id)) || null;
}

function publicObjectiveCurrentValue(state, objective, players = []) {
  const type = String(objective?.type || "");
  const statsByPlayer = state?.playerStats && typeof state.playerStats === "object" ? state.playerStats : {};
  const stats = Object.values(statsByPlayer).filter(s => s && typeof s === "object");

  if (type === "rounds" || type === "roundNumber") return clampInt(state?.roundNumber ?? 0, 0, 1000000);
  if (type === "activePlayers") return Array.isArray(players) ? players.length : 0;
  if (type === "audienceVotesApproved") return (state?.audienceVotes || []).filter(v => v && v.status === "approved").length;
  if (type === "audienceVotesOpen") return (state?.audienceVotes || []).filter(v => v && v.status === "open").length;
  if (type === "objectiveCompletions") return (state?.completedObjectiveEvents || []).filter(e => e && !String(e.objectiveId || "").startsWith("public:")).length;

  return stats.reduce((sum, item) => sum + statValueForObjective(item, objective, state), 0);
}

function publicObjectiveBaselineValue(state, objective, players = []) {
  const type = String(objective?.type || "");
  return CUMULATIVE_OBJECTIVE_TYPES.has(type) || ["rounds", "roundNumber", "audienceVotesApproved", "audienceVotesOpen", "objectiveCompletions"].includes(type)
    ? publicObjectiveCurrentValue(state, objective, players)
    : 0;
}

function ensurePublicObjectiveProgress(state, players = []) {
  state.publicObjectiveProgress = state.publicObjectiveProgress && typeof state.publicObjectiveProgress === "object" ? state.publicObjectiveProgress : {};
  const defs = getPublicObjectiveDefs();
  const validIds = new Set(defs.map(def => def.id));

  for (const key of Object.keys(state.publicObjectiveProgress)) {
    if (!validIds.has(String(key))) delete state.publicObjectiveProgress[key];
  }

  for (const def of defs) {
    const current = state.publicObjectiveProgress[def.id] && typeof state.publicObjectiveProgress[def.id] === "object" ? state.publicObjectiveProgress[def.id] : {};
    state.publicObjectiveProgress[def.id] = {
      objectiveId: def.id,
      assignedAt: current.assignedAt || new Date().toISOString(),
      baseline: current.baseline ?? publicObjectiveBaselineValue(state, def, players),
      progress: clampInt(current.progress ?? 0, 0, def.target),
      target: def.target,
      completed: Boolean(current.completed),
      rewardClaimed: Boolean(current.rewardClaimed)
    };
  }

  return state.publicObjectiveProgress;
}

function publicObjectiveRewardPoints(def) {
  if (def?.reward && typeof def.reward === "object") return clampInt(def.reward.points ?? def.rewardPoints ?? 0, 0, 999);
  return clampInt(def?.rewardPoints ?? 0, 0, 999);
}

function awardPublicObjectiveReward(state, def, players = []) {
  const rewardPoints = publicObjectiveRewardPoints(def);
  const rewardDescription = def.rewardDescription || (rewardPoints ? `Public objective awarded ${rewardPoints} point${rewardPoints === 1 ? "" : "s"} to each active player.` : "Public objective completed.");

  if (rewardPoints > 0) {
    for (const player of players || []) {
      if (!player?.id) continue;
      addPlayerPoints(state, player.id, rewardPoints, "public_objective_reward", { objectiveId: def.id });
    }
  }

  pushObjectiveEvent(state, {
    playerId: "public",
    objectiveId: `public:${def.id}`,
    title: `Public objective: ${def.title || def.id}`,
    rewardPoints,
    rewardDescription
  });
}

function evaluatePublicObjectives(state, players = []) {
  if (!state || typeof state !== "object") return state;
  const progressState = ensurePublicObjectiveProgress(state, players);

  for (const def of getPublicObjectiveDefs()) {
    const current = progressState[def.id];
    if (!current) continue;
    const baseline = clampInt(current.baseline ?? publicObjectiveBaselineValue(state, def, players), 0, 100000000);
    const raw = publicObjectiveCurrentValue(state, def, players);
    const progress = Math.min(def.target, Math.max(0, raw - baseline));
    const wasCompleted = Boolean(current.completed);
    const completed = progress >= def.target;

    current.objectiveId = def.id;
    current.baseline = baseline;
    current.progress = progress;
    current.target = def.target;
    current.completed = completed;

    if (completed && !wasCompleted && current.rewardClaimed !== true) {
      awardPublicObjectiveReward(state, def, players);
      current.rewardClaimed = true;
      current.completedAt = new Date().toISOString();
    }
  }

  return state;
}

function publicObjectiveViews(state, players = []) {
  evaluatePublicObjectives(state, players);
  return getPublicObjectiveDefs().map(def => {
    const progress = state.publicObjectiveProgress?.[def.id] || {};
    return {
      id: def.id,
      title: def.title || def.id,
      description: def.description || "",
      type: def.type,
      progress: clampInt(progress.progress ?? 0, 0, def.target),
      target: def.target,
      completed: Boolean(progress.completed),
      rewardClaimed: Boolean(progress.rewardClaimed),
      rewardPoints: publicObjectiveRewardPoints(def),
      rewardDescription: def.rewardDescription || def.reward || ""
    };
  });
}

function playerRoleId(state, playerId) {
  const assignment = state?.hiddenRoles?.[playerId];
  return assignment?.roleId ? String(assignment.roleId) : null;
}

function playerHasRole(state, playerId, roleId) {
  return playerRoleId(state, playerId) === String(roleId);
}

function ensureRolePassiveState(state, playerId) {
  state.rolePassiveState = state.rolePassiveState && typeof state.rolePassiveState === "object" ? state.rolePassiveState : {};
  state.rolePassiveState[playerId] = state.rolePassiveState[playerId] && typeof state.rolePassiveState[playerId] === "object" ? state.rolePassiveState[playerId] : {};
  return state.rolePassiveState[playerId];
}

function addRolePassivePoints(state, playerId, points, roleId, title, metadata = {}) {
  points = clampInt(points, 0, 999);
  if (!points) return;
  addPlayerPoints(state, playerId, points, "role_passive", { roleId, ...metadata });
  pushObjectiveEvent(state, {
    playerId,
    objectiveId: `role-passive:${roleId}:${Date.now()}`,
    title: title || `Role passive: ${roleId}`,
    rewardPoints: points,
    rewardDescription: `Role passive awarded ${points} point${points === 1 ? "" : "s"}.`
  });
}

function totalOwnedTokens(state, playerId) {
  const bucket = state?.playerTokens?.[playerId] || {};
  return Object.values(bucket).reduce((sum, v) => sum + clampInt(v, 0, 1000000), 0);
}

function roleFateKeyForValue(value) {
  value = clampInt(value, 0, 1000);
  if (value <= 0) return "vibe";
  const fate = (CONFIG?.fateWheel || []).find(f => value >= clampInt(f.min, 0, 1000) && value <= clampInt(f.max, 0, 1000));
  return fate?.key || (value >= 91 ? "deathwish" : value >= 76 ? "brutal" : value >= 61 ? "high" : value >= 36 ? "medium" : value >= 16 ? "low" : "warmup");
}

function processRolePassivesForRoundResult(state, result = {}) {
  if (!state || typeof state !== "object") return state;
  const roundNumber = clampInt(result.roundNumber ?? state.roundNumber ?? 0, 0, 1000000);
  const processedKey = `round:${roundNumber}`;
  state.rolePassiveState = state.rolePassiveState && typeof state.rolePassiveState === "object" ? state.rolePassiveState : {};
  state.rolePassiveState.__processedRoundResults = state.rolePassiveState.__processedRoundResults && typeof state.rolePassiveState.__processedRoundResults === "object" ? state.rolePassiveState.__processedRoundResults : {};
  if (state.rolePassiveState.__processedRoundResults[processedKey]) return state;
  state.rolePassiveState.__processedRoundResults[processedKey] = new Date().toISOString();

  const targets = Array.isArray(result.targets) ? result.targets : [];
  const targetIds = new Set(targets.map(t => String(t.playerId || t.id || t.deviceId || "")).filter(Boolean));
  const eventActive = Boolean(result.eventId || result.eventTitle);
  const resultType = String(result.resultType || "");

  for (const [playerId, assignment] of Object.entries(state.hiddenRoles || {})) {
    if (!assignment || typeof assignment !== "object") continue;
    const roleId = String(assignment.roleId || "");
    const roleState = ensureRolePassiveState(state, playerId);
    const isTargeted = targetIds.has(String(playerId));

    if (roleId === "survivor") {
      if (isTargeted) {
        roleState.survivorAvoidStreak = 0;
      } else {
        roleState.survivorAvoidStreak = clampInt(roleState.survivorAvoidStreak ?? 0, 0, 1000000) + 1;
        if (roleState.survivorAvoidStreak >= 3) {
          roleState.survivorAvoidStreak = 0;
          addRolePassivePoints(state, playerId, 1, roleId, "Survivor passive", { roundNumber });
        }
      }
    }

    if (roleId === "chaos-agent" && eventActive && Math.random() < 0.20) {
      addRolePassivePoints(state, playerId, 1, roleId, "Chaos Agent passive", { roundNumber, eventId: result.eventId || null });
    }
  }

  for (const target of targets) {
    const playerId = String(target.playerId || target.id || target.deviceId || "");
    if (!playerId) continue;
    const roleId = playerRoleId(state, playerId);
    const rolledValue = clampInt(target.rolledValue ?? target.value ?? result.value ?? 0, 0, 1000);
    const fateKey = roleFateKeyForValue(rolledValue);

    if (roleId === "gambler" && resultType === "shock") {
      const points = fateKey === "deathwish" ? 3 : fateKey === "brutal" ? 2 : fateKey === "high" ? 1 : 0;
      if (points > 0) {
        incrementPlayerServerStat(state, playerId, "highPlusSurvived", 1);
        addRolePassivePoints(state, playerId, points, roleId, "Gambler passive", { roundNumber, fateKey, rolledValue });
      }
    }

    if (roleId === "cultist" && eventActive) {
      incrementPlayerServerStat(state, playerId, "eventCardsExperienced", 1);
      addRolePassivePoints(state, playerId, 1, roleId, "Cultist passive", { roundNumber, eventId: result.eventId || null });
    }

    if (roleId === "chaos-agent" && eventActive) {
      incrementPlayerServerStat(state, playerId, "eventCardsExperienced", 1);
    }
  }

  return state;
}

function assignHiddenRolesToPlayers(state, shockers, { resetExisting = false } = {}) {
  state.hiddenRoles = state.hiddenRoles && typeof state.hiddenRoles === "object" ? state.hiddenRoles : {};
  let deck = getHiddenRoleDefs().slice().sort(() => Math.random() - 0.5);
  for (const s of shockers || []) {
    if (!resetExisting && state.hiddenRoles[s.id]) continue;
    if (!deck.length) deck = getHiddenRoleDefs().slice().sort(() => Math.random() - 0.5);
    const role = deck.pop();
    if (!role) {
      delete state.hiddenRoles[s.id];
      continue;
    }
    state.hiddenRoles[s.id] = {
      roleId: role.id,
      assignedAt: new Date().toISOString(),
      baseline: role.triggerType ? statValueForObjective(state.playerStats?.[s.id] || {}, { type: role.triggerType }, state) : 0,
      claims: 0
    };
  }
}

function pushObjectiveEvent(state, event) {
  state.completedObjectiveEvents = Array.isArray(state.completedObjectiveEvents) ? state.completedObjectiveEvents : [];
  const id = `${event.playerId}:${event.objectiveId}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
  const item = { id, createdAt: new Date().toISOString(), seen: false, ...event };
  state.completedObjectiveEvents.push(item);
  if (state.completedObjectiveEvents.length > 50) state.completedObjectiveEvents = state.completedObjectiveEvents.slice(-50);
  writeObjectiveEventDatabase(item);
}

function evaluateHiddenRoles(state) {
  if (!state || typeof state !== "object") return state;
  state.hiddenRoles = state.hiddenRoles && typeof state.hiddenRoles === "object" ? state.hiddenRoles : {};
  state.playerPoints = state.playerPoints && typeof state.playerPoints === "object" ? state.playerPoints : {};
  state.playerTokens = state.playerTokens && typeof state.playerTokens === "object" ? state.playerTokens : {};

  for (const [playerId, assignment] of Object.entries(state.hiddenRoles)) {
    if (!assignment || typeof assignment !== "object") continue;
    const role = hiddenRoleById(assignment.roleId);
    if (!role || !role.triggerType || role.triggerTarget <= 0) continue;
    const stats = state.playerStats?.[playerId] || {};
    const current = statValueForObjective(stats, { type: role.triggerType }, state);
    const baseline = clampInt(assignment.baseline ?? current, 0, 100000000);
    const progress = Math.max(0, current - baseline);
    const earnedClaims = role.repeatable ? Math.floor(progress / role.triggerTarget) : (progress >= role.triggerTarget ? 1 : 0);
    const previousClaims = clampInt(assignment.claims ?? 0, 0, 1000000);
    const newClaims = Math.max(0, earnedClaims - previousClaims);
    const remainderProgress = role.repeatable ? (progress % role.triggerTarget) : Math.min(progress, role.triggerTarget);
    assignment.progress = newClaims > 0 ? role.triggerTarget : remainderProgress;
    assignment.target = role.triggerTarget;
    if (newClaims > 0) {
      for (let i = 0; i < newClaims; i++) {
        if (role.rewardPoints > 0) addPlayerPoints(state, playerId, role.rewardPoints, "hidden_role_reward", { roleId: role.id });
        if (role.rewardToken && role.rewardTokenAmount > 0) addPlayerToken(state, playerId, role.rewardToken, role.rewardTokenAmount, "hidden_role_reward", { roleId: role.id });
        if (role.rewardModifier) queueRoundModifier(state, { ...role.rewardModifier, playerId, source: "hiddenRole", roleId: role.id });
        pushObjectiveEvent(state, {
          playerId,
          objectiveId: `hidden-role:${role.id}`,
          title: `Hidden role: ${role.title}`,
          rewardPoints: role.rewardPoints,
          rewardToken: role.rewardToken || null,
          rewardTokenAmount: role.rewardTokenAmount || 0,
          rewardDescription: role.rewardDescription || ""
        });
      }
      assignment.claims = previousClaims + newClaims;
      if (!role.repeatable) assignment.completed = true;
    }
  }
  return state;
}

function evaluateObjectives(state) {
  if (!state || typeof state !== "object") return state;
  const assignments = state.objectiveAssignments && typeof state.objectiveAssignments === "object" ? state.objectiveAssignments : {};
  state.playerPoints = state.playerPoints && typeof state.playerPoints === "object" ? state.playerPoints : {};

  for (const [playerId, assignmentList] of Object.entries(assignments)) {
    const list = Array.isArray(assignmentList) ? assignmentList : [assignmentList].filter(Boolean);
    const stats = state.playerStats?.[playerId] || {};
    const defs = readObjectives().objectives;
    const usedIds = new Set(list.map(a => String(a.objectiveId || a.id || "")).filter(Boolean));
    assignments[playerId] = list.map(a => {
      const def = objectiveById(a.objectiveId || a.id);
      if (!def) return a;
      const withBaseline = { ...a, baseline: a.baseline ?? objectiveBaselineValue(stats, def, state) };
      const progress = Math.min(def.target, objectiveProgressValue(stats, def, state, withBaseline));
      const wasCompleted = Boolean(a.completed);
      const completed = progress >= def.target;
      if (completed && !wasCompleted && a.rewardClaimed !== true) {
        const rewardPoints = clampInt(def.rewardPoints ?? 0, 0, 999);
        addPlayerPoints(state, playerId, rewardPoints, "objective_reward", { objectiveId: def.id });
        pushObjectiveEvent(state, { playerId, objectiveId: def.id, title: def.title, rewardPoints });

        // Completed objectives are immediately replaced so players always have something to work toward.
        const replacementPool = defs.filter(candidate => candidate.id !== def.id && !usedIds.has(candidate.id));
        const replacement = replacementPool.length ? replacementPool[Math.floor(Math.random() * replacementPool.length)] : null;
        if (replacement) {
          usedIds.delete(def.id);
          usedIds.add(replacement.id);
          return makeObjectiveAssignment(replacement, stats, state);
        }
      }
      return {
        objectiveId: def.id,
        assignedAt: a.assignedAt || new Date().toISOString(),
        baseline: withBaseline.baseline,
        progress,
        target: def.target,
        completed,
        rewardClaimed: Boolean(a.rewardClaimed ?? completed)
      };
    });
  }
  state.objectiveAssignments = assignments;
  return state;
}
