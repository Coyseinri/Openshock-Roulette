// OSR player state, stats and rendering helpers

function activeShockers() {
  return shockers.filter(s => !eliminated.has(s.id));
}

function getPlayerMultiplier(playerId) {
  const raw = playerMultipliers?.[playerId];
  const value = Number(raw === undefined || raw === null || raw === "" ? 100 : raw);
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function applyPlayerMultiplier(rolledValue, playerId) {
  const value = Number(rolledValue || 0);
  if (value <= 0) return 0;
  return Math.max(1, Math.ceil(value * (getPlayerMultiplier(playerId) / 100)));
}

function describeAppliedValues(targets, rolledValue, appliedById) {
  if (Number(rolledValue || 0) <= 0) return describeValue(0);
  const unique = Array.from(new Map((targets || []).filter(Boolean).map(s => [s.id, s])).values());
  if (unique.length === 1) {
    const s = unique[0];
    const mult = getPlayerMultiplier(s.id);
    const applied = appliedById?.[s.id] ?? applyPlayerMultiplier(rolledValue, s.id);
    return mult === 100
      ? describeValue(applied)
      : `Rolled ${rolledValue} · Multiplier ${mult}% · Applied ${applied}`;
  }
  const parts = unique.map(s => `${s.name}: ${appliedById?.[s.id] ?? applyPlayerMultiplier(rolledValue, s.id)} (${getPlayerMultiplier(s.id)}%)`);
  return `Rolled ${rolledValue} · Applied ${parts.join(", ")}`;
}

function defaultPlayerStats() {
  return {
    selected: 0,              // final selected target count after event-card changes
    shocked: 0,               // actual non-zero OpenShock activations
    vibes: 0,                 // zero-value / vibration rounds
    safe: 0,                  // target spinner SAFE rounds while player was active
    allTargeted: 0,           // times included by SHOCK ALL / forceAllTargets
    totalIntensity: 0,        // sum of non-zero selected values received
    bodyguards: 0,            // approved bodyguard offers
    cursesUsed: 0,            // approved curse actions
    chaosUsed: 0,             // chaos tokens used
    tokensBought: 0,          // tokens bought with points
    lastSelectedRound: 0,
    lastShockedRound: 0,
    lastVibeRound: 0
  };
}

function ensurePlayerStats(shocker) {
  if (!shocker?.id) return defaultPlayerStats();
  if (!playerStats[shocker.id]) playerStats[shocker.id] = defaultPlayerStats();
  playerStats[shocker.id] = { ...defaultPlayerStats(), ...playerStats[shocker.id] };
  return playerStats[shocker.id];
}

function ensureAllPlayerStats() {
  shockers.forEach(s => ensurePlayerStats(s));
}

function incrementPlayerStat(targets, statName, amount = 1) {
  (targets || []).forEach(s => {
    const stats = ensurePlayerStats(s);
    stats[statName] = Math.max(0, Number(stats[statName] || 0)) + Number(amount || 0);
  });
}

function recordSafeRoundForActivePlayers() {
  activeShockers().forEach(s => {
    const stats = ensurePlayerStats(s);
    stats.safe = Math.max(0, Number(stats.safe || 0)) + 1;
  });
}

function recordRoundTargets(targets, { value = null, valueByTargetId = null, wasAll = false } = {}) {
  const uniqueTargets = Array.from(new Map((targets || []).filter(Boolean).map(s => [s.id, s])).values());
  uniqueTargets.forEach(s => {
    const stats = ensurePlayerStats(s);
    stats.selected = Math.max(0, Number(stats.selected || 0)) + 1;
    stats.lastSelectedRound = roundNumber;

    if (wasAll) stats.allTargeted = Math.max(0, Number(stats.allTargeted || 0)) + 1;

    const actualValue = valueByTargetId && Object.prototype.hasOwnProperty.call(valueByTargetId, s.id) ? Number(valueByTargetId[s.id] || 0) : Number(value || 0);
    if (actualValue > 0) {
      stats.shocked = Math.max(0, Number(stats.shocked || 0)) + 1;
      stats.totalIntensity = Math.max(0, Number(stats.totalIntensity || 0)) + actualValue;
      stats.lastShockedRound = roundNumber;
    } else {
      stats.vibes = Math.max(0, Number(stats.vibes || 0)) + 1;
      stats.lastVibeRound = roundNumber;
    }
  });
}

function getPlayerStatValue(shocker, statName) {
  const stats = ensurePlayerStats(shocker);
  if (statName === "avgIntensity") {
    const shocked = Math.max(1, Number(stats.shocked || 0));
    return Number(stats.totalIntensity || 0) / shocked;
  }
  if (statName === "roundsSinceSelected") return stats.lastSelectedRound ? roundNumber - stats.lastSelectedRound : Number.MAX_SAFE_INTEGER;
  if (statName === "roundsSinceShocked") return stats.lastShockedRound ? roundNumber - stats.lastShockedRound : Number.MAX_SAFE_INTEGER;
  return Number(stats[statName] || 0);
}

function pickPlayerByStat(statName, direction = "least", excludedIds = new Set()) {
  const excluded = excludedIds instanceof Set ? excludedIds : new Set(excludedIds || []);
  const candidates = activeShockers().filter(s => !excluded.has(s.id));
  if (!candidates.length) return null;

  const sorted = candidates.slice().sort((a, b) => {
    const av = getPlayerStatValue(a, statName);
    const bv = getPlayerStatValue(b, statName);
    return direction === "most" ? bv - av : av - bv;
  });
  const bestValue = getPlayerStatValue(sorted[0], statName);
  const tied = sorted.filter(s => getPlayerStatValue(s, statName) === bestValue);
  return tied[Math.floor(Math.random() * tied.length)] || sorted[0];
}

function pickPlayerBySelector(selector, excludedIds = new Set()) {
  switch (selector) {
    case "lastSelected": return lastSelectedTargets[0] || null;
    case "lastShocked": return lastShockedTargets[0] || null;
    case "leastShocked": return pickPlayerByStat("shocked", "least", excludedIds);
    case "mostShocked": return pickPlayerByStat("shocked", "most", excludedIds);
    case "leastSelected": return pickPlayerByStat("selected", "least", excludedIds);
    case "mostSelected": return pickPlayerByStat("selected", "most", excludedIds);
    case "leastVibed": return pickPlayerByStat("vibes", "least", excludedIds);
    case "mostVibed": return pickPlayerByStat("vibes", "most", excludedIds);
    case "lowestIntensity": return pickPlayerByStat("totalIntensity", "least", excludedIds);
    case "highestIntensity": return pickPlayerByStat("totalIntensity", "most", excludedIds);
    case "longestNotSelected": return pickPlayerByStat("roundsSinceSelected", "most", excludedIds);
    case "longestNotShocked": return pickPlayerByStat("roundsSinceShocked", "most", excludedIds);
    default: return null;
  }
}

function getShockerById(id) {
  return shockers.find(s => String(s.id) === String(id)) || null;
}

function getShockerName(id, fallback = "Unknown player") {
  return getShockerById(id)?.name || fallback;
}

function serializeTargetIds(targets) {
  return (targets || []).filter(Boolean).map(s => s.id).filter(Boolean);
}

function serializeLastTargetPicked(picked) {
  if (!picked) return null;
  const data = {
    type: picked.type || null,
    label: picked.label || null
  };
  if (picked.shocker?.id) data.shockerId = picked.shocker.id;
  if (picked.type === "virtual" || picked.virtualTarget) {
    data.virtualId = picked.virtualId || picked.id || null;
    data.virtualName = picked.virtualName || picked.name || picked.label || null;
    data.resultText = picked.resultText || null;
  }
  return data;
}

function restoreLastTargetPicked(data) {
  if (!data || typeof data !== "object") return null;
  if (data.type === "player") {
    const shocker = getShockerById(data.shockerId);
    if (!shocker) return null;
    return { type: "player", label: shocker.name, shocker, weight: 1 };
  }
  if (data.type === "safe") return { type: "safe", label: data.label || "SAFE", weight: 1 };
  if (data.type === "all") return { type: "all", label: data.label || "ALL", weight: 1 };
  if (data.type === "virtual") {
    const name = data.virtualName || data.label || "Virtual Target";
    return {
      type: "virtual",
      label: name,
      name,
      virtualName: name,
      virtualId: data.virtualId || null,
      resultText: data.resultText || `${name} was selected. No real player is affected.`,
      virtualTarget: true,
      weight: 1
    };
  }
  return null;
}

function buildSessionSnapshot() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    roundNumber,
    eliminatedIds: Array.from(eliminated),
    playerStats,
    playerMultipliers,
    lastSelectedTargetIds: serializeTargetIds(lastSelectedTargets),
    lastShockedTargetIds: serializeTargetIds(lastShockedTargets),
    lastTargetPicked: serializeLastTargetPicked(lastTargetPicked),
    fateDeckKeys: (fateDeck || []).map(f => f.key).filter(Boolean)
  };
}

function applySessionSnapshot(state) {
  if (!state || typeof state !== "object") return;

  roundNumber = Math.max(0, Math.round(Number(state.roundNumber || 0)));
  eliminated = new Set(Array.isArray(state.eliminatedIds) ? state.eliminatedIds.map(String) : []);
  playerStats = state.playerStats && typeof state.playerStats === "object" ? state.playerStats : {};
  playerMultipliers = state.playerMultipliers && typeof state.playerMultipliers === "object" ? state.playerMultipliers : {};
  ensureAllPlayerStats();
  shockers.forEach(s => { if (playerMultipliers[s.id] === undefined) playerMultipliers[s.id] = 100; });
  shockers.forEach(s => { if (playerMultipliers[s.id] === undefined) playerMultipliers[s.id] = 100; });

  lastSelectedTargets = (Array.isArray(state.lastSelectedTargetIds) ? state.lastSelectedTargetIds : [])
    .map(getShockerById)
    .filter(Boolean);
  lastShockedTargets = (Array.isArray(state.lastShockedTargetIds) ? state.lastShockedTargetIds : [])
    .map(getShockerById)
    .filter(Boolean);
  lastTargetPicked = restoreLastTargetPicked(state.lastTargetPicked);

  const fateByKey = new Map((config?.fateWheel || []).map(f => [f.key, f]));
  fateDeck = (Array.isArray(state.fateDeckKeys) ? state.fateDeckKeys : [])
    .map(key => fateByKey.get(key))
    .filter(Boolean);

  targetResult.textContent = shockers.length ? `${shockers.length} collars loaded` : "No collars found";
  fateResult.textContent = "Waiting...";
  setMainResult(roundNumber > 0 ? `Restored round ${roundNumber}` : "Ready");
  renderPlayers();
  redrawAllWheels();
}

function updateStats() {
  const perRound = Math.max(0, Number(document.getElementById("escalationPerRound")?.value || 0));
  const escalation = document.getElementById("escalationEnabled")?.value === "on" ? roundNumber * perRound : 0;
  document.getElementById("roundStat").textContent = `Round ${roundNumber}`;
  document.getElementById("escalationStat").textContent = `Escalation +${escalation}`;
  document.getElementById("activeStat").textContent = `Active ${activeShockers().length}`;
}

function getPlayerMultiplierFromInput(input) {
  const value = Number(input?.value ?? 100);
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 100)));
}

function renderPlayers() {
  playersDiv.innerHTML = "";
  shockers.forEach(s => {
    const row = document.createElement("div");
    row.className = eliminated.has(s.id) ? "player eliminated" : "player";

    const info = document.createElement("div");

    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "playerNameButton";
    nameButton.textContent = s.name;
    nameButton.title = "Click to show/hide shocker ID";
    nameButton.onclick = () => row.classList.toggle("showId");

    const idLine = document.createElement("div");
    idLine.className = "playerId";
    idLine.textContent = s.id;

    const stats = ensurePlayerStats(s);
    const statsLine = document.createElement("div");
    statsLine.className = "playerStats";
    statsLine.textContent = `Selected ${stats.selected} · Shocked ${stats.shocked} · Vibes ${stats.vibes} · Total ${stats.totalIntensity}`;

    info.appendChild(nameButton);
    info.appendChild(idLine);
    info.appendChild(statsLine);

    const btn = document.createElement("button");
    btn.className = eliminated.has(s.id) ? "good" : "secondary";
    btn.textContent = eliminated.has(s.id) ? "Rejoin" : "Eliminate";
    btn.onclick = () => {
      if (eliminated.has(s.id)) eliminated.delete(s.id);
      else eliminated.add(s.id);
      renderPlayers();
      redrawAllWheels();
      saveSessionState("player elimination toggle");
    };

    row.appendChild(info);
    row.appendChild(btn);
    playersDiv.appendChild(row);
  });
}
