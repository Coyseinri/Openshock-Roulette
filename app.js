let config = null;
let shockers = [];
let eliminated = new Set();
let targetRotation = 0;
let fateRotation = 0;
let roundNumber = 0;
let fateDeck = [];
let eventCardsConfig = { enabled: false, cards: [] };
let activeRoundEvent = null;
let lastShockedTargets = [];
let lastSelectedTargets = [];
let lastTargetPicked = null;
let playerStats = {};
let playerMultipliers = {};
let sessionSaveEnabled = false;
let hostSpinPaused = false;
let hostCommandPollTimer = null;
let sessionSaveTimer = null;

const targetWheel = document.getElementById("targetWheel");
const fateWheel = document.getElementById("fateWheel");
const targetResult = document.getElementById("targetResult");
const fateResult = document.getElementById("fateResult");
const mainResult = document.getElementById("mainResult");
const playersDiv = document.getElementById("players");
const spinBtn = document.getElementById("spinBtn");
const eventOverlay = document.getElementById("eventOverlay");
const eventCardBox = document.getElementById("eventCardBox");
const eventTitle = document.getElementById("eventTitle");
const eventDescription = document.getElementById("eventDescription");
const eventPickerLine = document.getElementById("eventPickerLine");
const eventOptions = document.getElementById("eventOptions");
const eventResult = document.getElementById("eventResult");
const eventContinueBtn = document.getElementById("eventContinueBtn");


async function postEventLog(payload) {
  try {
    await fetch("/api/event-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  } catch (err) {
    log(`Could not write event log: ${err.message}`);
  }
}

async function postRoundResult(payload) {
  try {
    await fetch("/api/round-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  } catch (err) {
    log(`Could not write round result: ${err.message}`);
  }
}

function log(msg) {
  const el = document.getElementById("log");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + el.textContent;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randInt(min, max) {
  min = Math.round(Number(min)); max = Math.round(Number(max));
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = min;
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

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

async function loadSessionState() {
  try {
    const res = await fetch("/api/session");
    const state = await res.json();
    if (!res.ok) throw new Error(state.error || "Could not load session state");
    applySessionSnapshot(state);
    sessionSaveEnabled = true;
    log(`Session restored from server state. Round ${roundNumber}.`);
  } catch (err) {
    sessionSaveEnabled = true;
    ensureAllPlayerStats();
    log(`Session restore skipped: ${err.message}`);
  }
}

function saveSessionState(reason = "state change") {
  if (!sessionSaveEnabled) return;
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(async () => {
    sessionSaveTimer = null;
    try {
      const snapshot = buildSessionSnapshot();
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save session state");
      log(`Session saved (${reason}).`);
      if (document.getElementById("objectiveDetails")?.open) loadPlayerObjectivePanel();
    } catch (err) {
      log(`Session save failed: ${err.message}`);
    }
  }, 150);
}

async function getServerSessionState() {
  const res = await fetch("/api/session", { cache: "no-store" });
  const state = await res.json();
  if (!res.ok) throw new Error(state.error || "Could not load server session");
  return state;
}

async function consumeRoundModifiers(modifiers) {
  const ids = (modifiers || []).map(m => typeof m === "string" ? m : m?.id).filter(Boolean);
  if (!ids.length) return;
  try {
    await fetch("/api/round-modifiers/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
  } catch (err) {
    log(`Could not consume pending modifiers: ${err.message}`);
  }
}

function markRoundModifierConsumed(roundState, mod, reason = "used") {
  if (!roundState || !mod?.id) return;
  if (!roundState.consumedModifierIds) roundState.consumedModifierIds = new Set();
  roundState.consumedModifierIds.add(String(mod.id));
  mod.consumedReason = reason;
}

function consumedRoundModifierIds(roundState) {
  return Array.from(roundState?.consumedModifierIds || []);
}

function applyPendingModifiersBeforeTarget(roundState) {
  const mods = roundState.pendingRoundModifiers || [];
  roundState.bodyguardRedirects = new Map();
  for (const mod of mods) {
    if (mod.type === "bodyguardNextRound" && mod.targetPlayerId && mod.bodyguardPlayerId) {
      const protectedId = String(mod.targetPlayerId);
      const bodyguardId = String(mod.bodyguardPlayerId);
      const protectedPlayer = getShockerById(protectedId);
      const bodyguard = getShockerById(bodyguardId);
      if (protectedPlayer && bodyguard && protectedId !== bodyguardId) {
        roundState.bodyguardRedirects.set(protectedId, { protectedId, bodyguardId, protectedPlayer, bodyguard, modifierId: mod.id });
        log(`Pending modifier: ${bodyguard.name} is bodyguarding ${protectedPlayer.name}.`);
      }
    }
    if (mod.type === "shieldNextRound" && mod.targetPlayerId) {
      roundState.excludeTargetIds.add(String(mod.targetPlayerId));
      markRoundModifierConsumed(roundState, mod, "shield applied");
      log(`Pending modifier: ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)} is shielded this round.`);
    }
    if (mod.type === "immunityNextRound" && mod.targetPlayerId) {
      roundState.immuneTargetIds = roundState.immuneTargetIds || new Set();
      roundState.immuneTargetIds.add(String(mod.targetPlayerId));
      log(`Pending modifier: ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)} has immunity this round.`);
    }
    if (mod.type === "forcedDoubleShockNextRound" && mod.targetPlayerId) {
      roundState.forcedDoubleShockTargetIds = roundState.forcedDoubleShockTargetIds || new Set();
      roundState.forcedDoubleShockTargetIds.add(String(mod.targetPlayerId));
      log(`Pending modifier: forced double shock armed for ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)}.`);
    }
    if (mod.type === "volunteerNextRound" && mod.playerId) {
      const volunteer = getShockerById(mod.playerId);
      if (volunteer) {
        roundState.extraTargets.push(volunteer);
        markRoundModifierConsumed(roundState, mod, "volunteer applied");
      }
    }

    if (mod.type === "guaranteedPickNextRound" && mod.targetPlayerId) {
      const guaranteed = getShockerById(mod.targetPlayerId);
      if (guaranteed && !roundState.guaranteedTargets.some(s => String(s.id) === String(guaranteed.id))) {
        roundState.guaranteedTargets.push(guaranteed);
        markRoundModifierConsumed(roundState, mod, "guaranteed pick applied");
        log(`Guaranteed pick active: ${guaranteed.name} will be included this round.`);
      }
    }
    if (mod.type === "chaosNextRound") {
      roundState.equalFateWeights = true;
      roundState.disableTargetTypes = roundState.disableTargetTypes || new Set();
      roundState.disableTargetTypes.add("safe");
      roundState.targetMultipliers.push({ targetType: "all", multiplier: 80 });
      roundState.forceEqualTargetWeights = true;
      markRoundModifierConsumed(roundState, mod, "chaos applied");
      log(`Chaos token activated by ${getShockerName(mod.playerId, "a player")}.`);
    }
    if (Number(mod.targetWeightMultiplier || 1) !== 1 && mod.targetPlayerId) {
      roundState.targetMultipliers.push({ targetId: String(mod.targetPlayerId), multiplier: Number(mod.targetWeightMultiplier) });
      log(`Pending modifier: target weight x${Number(mod.targetWeightMultiplier)} for ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)}.`);
    }
  }

  if (roundState.guaranteedTargets?.length) {
    const guaranteed = Array.from(new Map(roundState.guaranteedTargets.map(s => [String(s.id), s])).values());
    if (roundState.forcedTarget?.type === "all") {
      log("Guaranteed picks are included by SHOCK ALL.");
    } else if (roundState.forcedTarget?.type === "player" && roundState.forcedTarget.shocker) {
      const combined = Array.from(new Map([roundState.forcedTarget.shocker, ...guaranteed].map(s => [String(s.id), s])).values());
      roundState.forcedTarget = { type: combined.length > 1 ? "multi" : "player", label: combined.map(s => s.name).join(" + "), shocker: combined[0], shockers: combined, weight: 1 };
    } else {
      roundState.forcedTarget = { type: guaranteed.length > 1 ? "multi" : "player", label: guaranteed.map(s => s.name).join(" + "), shocker: guaranteed[0], shockers: guaranteed, weight: 1 };
    }
  }
}

function applyPendingModifiersAfterTarget(roundState, targetPicked, targets) {
  const mods = roundState.pendingRoundModifiers || [];
  targets = Array.from(new Map((targets || []).filter(Boolean).map(t => [t.id, t])).values());
  for (const mod of mods) {
    if (mod.type === "bodyguardNextRound") {
      const protectedId = String(mod.targetPlayerId || "");
      const bodyguard = getShockerById(mod.bodyguardPlayerId);
      const protectedPlayer = getShockerById(protectedId);
      const selectedProtected = targets.some(t => String(t.id) === protectedId);
      const alreadyRedirected = targetPicked?.bodyguardRedirect && String(targetPicked?.originalShocker?.id || "") === protectedId;
      if (bodyguard && selectedProtected) {
        targets = targets.filter(t => String(t.id) !== protectedId);
        if (!targets.some(t => String(t.id) === String(bodyguard.id))) targets.push(bodyguard);
        const redirectInfo = { bodyguardRedirect: true, originalShocker: protectedPlayer, bodyguardShocker: bodyguard };
        targetPicked = targetPicked?.type === "all"
          ? { ...targetPicked, ...redirectInfo }
          : { type: "player", label: protectedPlayer?.name || targetPicked?.label || "Protected", shocker: protectedPlayer || targetPicked?.shocker, weight: 1, ...redirectInfo };
        markRoundModifierConsumed(roundState, mod, "bodyguard redirected");
        log(`${bodyguard.name} bodyguards ${protectedPlayer?.name || protectedId}.`);
      } else if (alreadyRedirected && bodyguard) {
        targets = [bodyguard];
        markRoundModifierConsumed(roundState, mod, "bodyguard redirected");
        log(`${bodyguard.name} bodyguards ${protectedPlayer?.name || protectedId}.`);
      }
    }
    if ((mod.type === "mercyNextRound" || mod.type === "blessingNextRound") && mod.targetPlayerId && targets.some(t => t.id === String(mod.targetPlayerId))) {
      const cap = normalizeFateCap(mod.capFateMax || "low");
      if (cap !== null) roundState.capFateMax = roundState.capFateMax === null ? cap : Math.min(roundState.capFateMax, cap);
      if (Number(mod.valueOffset || 0)) roundState.valueOffset += Number(mod.valueOffset || 0);
      markRoundModifierConsumed(roundState, mod, "blessing/mercy applied");
      log(`Blessing/Mercy applied to ${mod.targetPlayerId}.`);
    }
    if (mod.type === "curseNextRound" && mod.targetPlayerId && targets.some(t => t.id === String(mod.targetPlayerId))) {
      roundState.valueOffset += Number(mod.valueOffset || 10);
      markRoundModifierConsumed(roundState, mod, "curse applied");
      log(`Curse applied to ${mod.targetPlayerId}.`);
    }
  }
  return { targetPicked, targets };
}


async function pollHostSpinnerCommands() {
  try {
    const res = await fetch("/api/host/spinner-commands", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return;
    for (const cmd of data.commands || []) {
      if (cmd.command === "pause") { hostSpinPaused = true; setMainResult("Paused by host"); log("Host command: pause."); }
      if (cmd.command === "resume") { hostSpinPaused = false; setMainResult("Ready"); log("Host command: resume."); }
      if (cmd.command === "spin") {
        log("Host command: spin requested.");
        if (!spinBtn.disabled && !hostSpinPaused) spinRound();
      }
    }
  } catch {}
}

function startHostCommandPolling() {
  if (hostCommandPollTimer) return;
  hostCommandPollTimer = setInterval(pollHostSpinnerCommands, 1000);
}

async function resetServerSessionState() {
  try {
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
      sessionSaveTimer = null;
    }

    const res = await fetch("/api/session/reset", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not reset session state");

    if (data.archivedTo) log(`Server session state archived to ${data.archivedTo}.`);
    else log("Server session state reset. No previous state file existed to archive.");

    return data.session || null;
  } catch (err) {
    log(`Server session reset failed: ${err.message}`);
    window.alert(`Could not reset server session state: ${err.message}`);
    return null;
  }
}

function getPercent(id) {
  const value = Number(document.getElementById(id).value || 0);
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rollPercent(percent) {
  return Math.random() * 100 < percent;
}

function setMainResult(text, cls="") {
  mainResult.className = "bigResult " + cls;
  mainResult.textContent = text;
}

function normalizeEventCategory(card) {
  const raw = String(card?.category || card?.type || card?.tone || "").toLowerCase();
  if (["good", "beneficial", "mercy", "safe"].includes(raw)) return "good";
  if (["evil", "bad", "punishment", "red"].includes(raw)) return "evil";
  if (["chaos", "wild", "random"].includes(raw)) return "chaos";
  if (["neutral", "mixed", "orange"].includes(raw)) return "neutral";
  const text = `${card?.id || ""} ${card?.title || ""} ${card?.description || ""}`.toLowerCase();
  if (text.includes("safe") || text.includes("mercy") || text.includes("escape")) return "good";
  if (text.includes("all") || text.includes("double") || text.includes("death") || text.includes("brutal")) return "evil";
  if (text.includes("random") || text.includes("swap") || text.includes("reverse")) return "chaos";
  return "neutral";
}

function updateEventCardPanel(card, stateText = null) {
  const panel = document.getElementById("eventCardPanel");
  const title = document.getElementById("eventCardTitle");
  const description = document.getElementById("eventCardDescription");

  if (!panel || !title || !description) return;

  if (!card) {
    panel.className = "eventCardPanel none";
    title.textContent = "No Event Card";
    description.textContent = stateText || "Waiting for the next event roll...";
    return;
  }

  const category = normalizeEventCategory(card);
  panel.className = `eventCardPanel ${category}`;
  title.textContent = card.title || card.name || card.id || "Event Card";
  description.textContent = card.description || card.text || card.effect || "No description provided.";
}


async function loadConfig() {
  const res = await fetch("/api/config");
  config = await res.json();
  applyConfigToForm();
  renderFateSettings();
  updateConfigPreview();
  redrawAllWheels();
  const displayTitle = config.app?.displayTitle || config.ui?.pageTitle || config.app?.name || "OpenShock Roulette";
  document.getElementById("pageTitle").textContent = displayTitle;
  document.title = displayTitle;
  const subtitleEl = document.getElementById("subtitleText");
  if (subtitleEl) subtitleEl.textContent = config.app?.subtitle || subtitleEl.textContent;
  log("Loaded config.json.");
}

function syncPageQrControls() {
  // Page and QR settings are consolidated. QR follows the page setting.
}

function applyConfigToForm() {
  document.getElementById("playerWeight").value = config.targetWheel?.playerWeight ?? 100;
  document.getElementById("safeWeight").value = config.targetWheel?.safeWeight ?? 10;
  document.getElementById("shockAllWeight").value = config.targetWheel?.shockAllWeight ?? 5;

  document.getElementById("doubleHitChance").value = config.game?.hiddenDoubleHitChancePercent ?? 5;
  document.getElementById("pauseMinMs").value = config.game?.pauseBeforeFateMinMs ?? 1500;
  document.getElementById("pauseMaxMs").value = config.game?.pauseBeforeFateMaxMs ?? 3000;
  document.getElementById("hitDelayMinMs").value = config.game?.preHitDelayMinMs ?? 1000;
  document.getElementById("hitDelayMaxMs").value = config.game?.preHitDelayMaxMs ?? 3000;
  document.getElementById("doubleDelayMinMs").value = config.game?.doubleHitDelayMinMs ?? 700;
  document.getElementById("doubleDelayMaxMs").value = config.game?.doubleHitDelayMaxMs ?? 2500;
  document.getElementById("duration").value = config.safety?.defaultDurationMs ?? 700;

  document.getElementById("noRepeatMode").value = config.game?.noRepeatFate ? "on" : "off";
  document.getElementById("escalationEnabled").value = config.game?.escalationEnabled ? "on" : "off";
  document.getElementById("escalationPerRound").value = config.game?.escalationPerRound ?? 2;
  const effectiveEventCards = {
    enabled: config.eventCards?.enabled ?? eventCardsConfig?.enabled ?? false,
    chancePercent: config.eventCards?.chancePercent ?? eventCardsConfig?.chancePercent ?? 18,
    displayDurationMs: config.eventCards?.displayDurationMs ?? eventCardsConfig?.displayDurationMs ?? 4000
  };

  document.getElementById("eventCardsEnabled").value = effectiveEventCards.enabled ? "on" : "off";
  document.getElementById("eventCardChance").value = effectiveEventCards.chancePercent;
  document.getElementById("eventCardDisplayMs").value = effectiveEventCards.displayDurationMs;

  const playerPages = config.playerPages || {};
  document.getElementById("playerPagesEnabled").value = (playerPages.enabled ?? playerPages.qrCodesEnabled ?? true) ? "on" : "off";
  document.getElementById("playerAutoRefreshMs").value = playerPages.autoRefreshMs ?? 2000;
  const hostPage = config.hostPage || {};
  document.getElementById("hostPageEnabled").value = (hostPage.enabled ?? hostPage.qrCodesEnabled ?? true) ? "on" : "off";
  const audiencePage = config.audiencePage || {};
  document.getElementById("audiencePageEnabled").value = (audiencePage.enabled ?? audiencePage.qrCodesEnabled ?? true) ? "on" : "off";

  const economy = config.economy || {};
  document.getElementById("objectiveRewardPoints").value = economy.objectiveRewardPoints ?? 3;
  document.getElementById("bodyguardRewardPoints").value = economy.bodyguardRewardPoints ?? 2;
  document.getElementById("blessingCost").value = economy.blessingCost ?? 5;
  document.getElementById("curseCost").value = economy.curseCost ?? 5;
  document.getElementById("shieldCost").value = economy.shieldCost ?? 8;
  document.getElementById("mercyCost").value = economy.mercyCost ?? 6;
  document.getElementById("audienceTokenGrantAmount").value = economy.audienceTokenGrantAmount ?? 1;
  document.getElementById("audienceVoteThreshold").value = economy.audienceVoteThreshold ?? 3;
  document.getElementById("audienceCooldownSeconds").value = economy.audienceCooldownSeconds ?? 20;
  document.getElementById("audienceMaxVotesPerRound").value = economy.audienceMaxVotesPerRound ?? 1;
  const tokenCosts = economy.tokenCosts || {};
  document.getElementById("shieldTokenCost").value = tokenCosts.shield ?? economy.shieldCost ?? 8;
  document.getElementById("mercyTokenCost").value = tokenCosts.mercy ?? economy.mercyCost ?? 6;
  document.getElementById("blessingTokenCost").value = tokenCosts.blessing ?? economy.blessingCost ?? 5;
  document.getElementById("curseTokenCost").value = tokenCosts.curse ?? economy.curseCost ?? 5;
  document.getElementById("chaosTokenCost").value = tokenCosts.chaos ?? 10;
  document.getElementById("guaranteeTokenCost").value = tokenCosts.guarantee ?? economy.guaranteeTokenCost ?? economy.guaranteedPickCost ?? 12;
  document.getElementById("immunityTokenCost").value = tokenCosts.immunity ?? economy.immunityTokenCost ?? 10;
  document.getElementById("doubleShockTokenCost").value = tokenCosts.doubleShock ?? economy.doubleShockTokenCost ?? 10;
}

async function loadPlayerObjectivePanel() {
  const panel = document.getElementById("objectivePanelBody");
  if (!panel) return;
  try {
    const [linksRes, roleLinksRes, objectivesRes] = await Promise.all([
      fetch("/api/player-links"),
      fetch("/api/role-links"),
      fetch("/api/objectives")
    ]);
    const linksData = await linksRes.json();
    const roleLinksData = await roleLinksRes.json();
    const objectivesData = await objectivesRes.json();
    if (!linksRes.ok) throw new Error(linksData.error || "Could not load player links");
    if (!roleLinksRes.ok) throw new Error(roleLinksData.error || "Could not load host/audience links");
    if (!objectivesRes.ok) throw new Error(objectivesData.error || "Could not load objectives");

    const session = objectivesData.session || {};
    const assignments = session.objectiveAssignments || {};
    const defs = new Map((objectivesData.definitions?.objectives || []).map(o => [o.id, o]));
    const points = session.playerPoints || {};
    const tokens = session.playerTokens || {};
    const playerName = id => (linksData.links || []).find(l => String(l.playerId) === String(id))?.name || id || "unknown";
    const pendingMods = session.pendingRoundModifiers || [];
    const audienceVotes = session.audienceVotes || [];
    const objectiveEvents = (session.completedObjectiveEvents || []).filter(e => !e.seen);

    let html = `<div class="objectiveToolbar">
      <button class="secondary" id="refreshObjectivesBtn" type="button">Refresh</button>
      <button class="good" id="generateObjectivesBtn" type="button">Generate / reroll objectives</button>
    </div>`;
    let stateHtml = ``;

    html += `<div class="objectiveNote">Player pages + QR: <strong>${linksData.enabled ? "enabled" : "disabled"}</strong> · Base URL: <code>${escapeHtml(linksData.publicBaseUrl || "")}</code></div>`;

    if (objectiveEvents.length) {
      html += `<h4>Objective completions</h4><div class="pendingActionList">`;
      for (const e of objectiveEvents) {
        html += `<div class="pendingAction objectiveCompletePopup"><strong>${escapeHtml(playerName(e.playerId))}</strong> completed <strong>${escapeHtml(e.title)}</strong> (+${escapeHtml(e.rewardPoints || 0)} pts) <button class="secondary ackObjectiveBtn" type="button" data-id="${escapeHtml(e.id)}">Acknowledge</button></div>`;
      }
      html += `</div>`;
    }

    stateHtml += `<h4>Pending Next Round effects</h4>`;
    if (!pendingMods.length) stateHtml += `<div class="objectiveNote">No pending next-round effects.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const mod of pendingMods) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(mod.type)}</strong> ${mod.targetPlayerId ? `→ ${escapeHtml(playerName(mod.targetPlayerId))}` : ""}${mod.bodyguardPlayerId ? ` · Bodyguard: ${escapeHtml(playerName(mod.bodyguardPlayerId))}` : ""}</div>`;
      }
      stateHtml += `</div>`;
    }

    stateHtml += `<h4>Audience votes</h4>`;
    const openVotes = audienceVotes.filter(v => v.status === "open");
    if (!openVotes.length) stateHtml += `<div class="objectiveNote">No open audience votes.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const vote of openVotes) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(vote.type)}</strong>${vote.tokenType ? ` (${escapeHtml(vote.tokenType)} token)` : ""} → ${escapeHtml(playerName(vote.targetPlayerId))} · Votes: ${escapeHtml(vote.count || 0)}
          <button class="good approveVoteBtn" type="button" data-id="${escapeHtml(vote.id)}">Approve</button>
          <button class="danger rejectVoteBtn" type="button" data-id="${escapeHtml(vote.id)}">Reject</button></div>`;
      }
      stateHtml += `</div>`;
    }
    html += `<h4>Host / audience</h4><div class="playerLinkGrid">`;
    for (const role of ["host", "audience"]) {
      const item = roleLinksData[role];
      if (!item) continue;
      html += `<div class="playerLinkCard">
        <div class="playerLinkHeader"><strong>${role.toUpperCase()}</strong><span>${item.enabled ? "enabled" : "disabled"}</span></div>
        <div class="playerUrl"><input readonly value="${escapeHtml(item.url || "")}"></div>
        ${item.qrDataUrl ? `<img class="qrCode" alt="QR for ${role}" src="${item.qrDataUrl}">` : `<div class="qrDisabled">QR disabled</div>`}
      </div>`;
    }
    html += `</div>`;

    const pending = (session.pendingPlayerActions || []).filter(a => a.status === "pending");
    stateHtml += `<h4>Pending actions</h4>`;
    if (!pending.length) stateHtml += `<div class="objectiveNote">No pending player/audience actions.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const action of pending) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(action.type)}</strong>${action.tokenType ? ` (${escapeHtml(action.tokenType)} token)` : ""} from ${escapeHtml(playerName(action.playerId || action.bodyguardPlayerId) || action.source || "unknown")} ${action.targetPlayerId ? `→ ${escapeHtml(playerName(action.targetPlayerId))}` : ""}
          <button class="good approveActionBtn" type="button" data-id="${escapeHtml(action.id)}">Approve</button>
          <button class="danger rejectActionBtn" type="button" data-id="${escapeHtml(action.id)}">Reject</button>
        </div>`;
      }
      stateHtml += `</div>`;
    }

    stateHtml += `<h4>Session stats</h4>`;
    const sessionStats = (linksData.links || []).map(link => ({ link, stats: session.playerStats?.[link.playerId] || {}, points: Number(points[link.playerId] || 0) }))
      .sort((a, b) => Number(b.stats.shocked || 0) - Number(a.stats.shocked || 0));
    if (!sessionStats.length) stateHtml += `<div class="objectiveNote">No session stats yet.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const item of sessionStats) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(item.link.name)}</strong> · Shocked ${escapeHtml(item.stats.shocked || 0)} · Selected ${escapeHtml(item.stats.selected || 0)} · Vibes ${escapeHtml(item.stats.vibes || 0)} · Points ${escapeHtml(item.points)}</div>`;
      }
      stateHtml += `</div>`;
    }

    html += `<h4>Player links / objectives</h4><div class="playerLinkGrid">`;
    for (const link of linksData.links || []) {
      const list = Array.isArray(assignments[link.playerId]) ? assignments[link.playerId] : [];
      const objectiveText = list.length
        ? list.map(a => {
            const def = defs.get(a.objectiveId);
            const title = def?.title || a.objectiveId;
            return `${escapeHtml(title)}: ${a.progress ?? 0}/${a.target ?? def?.target ?? "?"}${a.completed ? " ✅" : ""}`;
          }).join("<br>")
        : "No objective assigned";
      const tokenText = Object.entries(tokens[link.playerId] || {}).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${escapeHtml(k)} x${escapeHtml(v)}`).join(" · ") || "No tokens";
      const role = session.hiddenRoles?.[link.playerId]?.roleId || "not assigned";
      const multiplier = Number(session.playerMultipliers?.[link.playerId] ?? playerMultipliers?.[link.playerId] ?? 100);
      html += `<div class="playerLinkCard">
        <div class="playerLinkHeader"><strong>${escapeHtml(link.name)}</strong><span>${Number(points[link.playerId] || 0)} pts</span></div>
        <div class="objectiveMini"><strong>Multiplier:</strong> <input class="playerMultiplierInput" type="number" min="0" max="100" step="1" data-player-id="${escapeHtml(link.playerId)}" value="${escapeHtml(Math.max(0, Math.min(100, Math.round(Number.isFinite(multiplier) ? multiplier : 100))))}">%</div>
        <div class="objectiveMini"><strong>Role:</strong> ${escapeHtml(role)}</div>
        <div class="objectiveMini"><strong>Tokens:</strong> ${tokenText}</div>
        <div class="objectiveMini">${objectiveText}</div>
        <div class="playerUrl"><input readonly value="${escapeHtml(link.url)}"></div>
        ${link.qrDataUrl ? `<img class="qrCode" alt="QR for ${escapeHtml(link.name)}" src="${link.qrDataUrl}">` : `<div class="qrDisabled">QR disabled</div>`}
      </div>`;
    }
    html += `</div>`;
    panel.innerHTML = html;
    const gameStatePanel = document.getElementById("gameStatePanelBody");
    if (gameStatePanel) gameStatePanel.innerHTML = stateHtml || `<div class="objectiveNote">No pending state items.</div>`;

    document.querySelectorAll(".playerMultiplierInput").forEach(input => {
      input.addEventListener("change", async () => {
        const id = input.dataset.playerId;
        if (!id) return;
        playerMultipliers[id] = getPlayerMultiplierFromInput(input);
        await savePlayerMultipliers();
        await loadPlayerObjectivePanel();
      });
    });

    document.getElementById("refreshObjectivesBtn")?.addEventListener("click", loadPlayerObjectivePanel);
    document.getElementById("generateObjectivesBtn")?.addEventListener("click", async () => {
      const ok = window.confirm("Generate/reroll secret objectives for all players?");
      if (!ok) return;
      const res = await fetch("/api/objectives/generate", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ resetExisting: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate objectives");
      log("Secret objectives generated.");
      await loadPlayerObjectivePanel();
    });
    document.querySelectorAll(".approveActionBtn,.rejectActionBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const approved = btn.classList.contains("approveActionBtn");
        const res = await fetch("/api/host/action?key=host", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ actionId: btn.dataset.id, approved }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not resolve action");
        log(`Pending action ${approved ? "approved" : "rejected"}.`);
        await loadPlayerObjectivePanel();
      });
    });
    document.querySelectorAll(".approveVoteBtn,.rejectVoteBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const approved = btn.classList.contains("approveVoteBtn");
        const res = await fetch("/api/host/audience-vote?key=host", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ voteId: btn.dataset.id, approved }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not resolve audience vote");
        log(`Audience vote ${approved ? "approved" : "rejected"}.`);
        await loadPlayerObjectivePanel();
      });
    });
    document.querySelectorAll(".ackObjectiveBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const res = await fetch("/api/host/objective-events/ack?key=host", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ids: [btn.dataset.id] }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not acknowledge objective event");
        await loadPlayerObjectivePanel();
      });
    });
  } catch (err) {
    panel.innerHTML = `<div class="warningText">Could not load player/objective panel: ${escapeHtml(err.message)}</div>`;
    const gameStatePanel = document.getElementById("gameStatePanelBody");
    if (gameStatePanel) gameStatePanel.innerHTML = `<div class="warningText">Could not load game state: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadEventCards() {
  try {
    const res = await fetch("/api/event-cards");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load event-cards.json");
    eventCardsConfig = data;
    log(`Loaded event-cards.json with ${(data.cards || []).length} card(s).`);
  } catch (err) {
    eventCardsConfig = { enabled: false, cards: [] };
    log(`Event cards disabled: ${err.message}`);
  }
}

function collectFormToConfig() {
  config.targetWheel = config.targetWheel || {};
  config.game = config.game || {};
  config.safety = config.safety || {};
  config.eventCards = config.eventCards || {};

  config.targetWheel.playerWeight = num("playerWeight", 100);
  config.targetWheel.safeWeight = num("safeWeight", 10);
  config.targetWheel.shockAllWeight = num("shockAllWeight", 5);

  config.game.hiddenDoubleHitChancePercent = num("doubleHitChance", 5);
  config.game.pauseBeforeFateMinMs = num("pauseMinMs", 1500);
  config.game.pauseBeforeFateMaxMs = num("pauseMaxMs", 3000);
  config.game.preHitDelayMinMs = num("hitDelayMinMs", 1000);
  config.game.preHitDelayMaxMs = num("hitDelayMaxMs", 3000);
  config.game.doubleHitDelayMinMs = num("doubleDelayMinMs", 700);
  config.game.doubleHitDelayMaxMs = num("doubleDelayMaxMs", 2500);
  config.safety.defaultDurationMs = num("duration", 700);

  config.game.noRepeatFate = document.getElementById("noRepeatMode").value === "on";
  config.game.escalationEnabled = document.getElementById("escalationEnabled").value === "on";
  config.game.escalationPerRound = num("escalationPerRound", 2);
  config.eventCards.enabled = document.getElementById("eventCardsEnabled").value === "on";
  config.eventCards.chancePercent = Math.max(0, Math.min(100, num("eventCardChance", 18)));
  config.eventCards.displayDurationMs = Math.max(0, numberWithDefault(document.getElementById("eventCardDisplayMs")?.value, config.eventCards.displayDurationMs ?? 4000));
  config.playerPages = config.playerPages || {};
  const playerPagesOn = document.getElementById("playerPagesEnabled").value === "on";
  config.playerPages.enabled = playerPagesOn;
  delete config.playerPages.qrCodesEnabled;
  config.playerPages.autoRefreshMs = Math.max(500, num("playerAutoRefreshMs", 2000));
  config.playerPages.useShockerIdAsAccessKey = Boolean(config.playerPages.useShockerIdAsAccessKey ?? false);
  config.hostPage = config.hostPage || {};
  const hostPageOn = document.getElementById("hostPageEnabled").value === "on";
  config.hostPage.enabled = hostPageOn;
  delete config.hostPage.qrCodesEnabled;
  delete config.hostPage.accessKey;
  config.hostPage.allowManualControl = true;
  config.audiencePage = config.audiencePage || {};
  const audiencePageOn = document.getElementById("audiencePageEnabled").value === "on";
  config.audiencePage.enabled = audiencePageOn;
  delete config.audiencePage.qrCodesEnabled;
  delete config.audiencePage.accessKey;
  config.economy = config.economy || {};
  config.economy.objectiveRewardPoints = Math.max(0, num("objectiveRewardPoints", 3));
  config.economy.bodyguardRewardPoints = Math.max(0, num("bodyguardRewardPoints", 2));
  config.economy.blessingCost = Math.max(0, num("blessingCost", 5));
  config.economy.curseCost = Math.max(0, num("curseCost", 5));
  config.economy.shieldCost = Math.max(0, num("shieldCost", 8));
  config.economy.mercyCost = Math.max(0, num("mercyCost", 6));
  config.economy.audienceTokenGrantAmount = Math.max(1, num("audienceTokenGrantAmount", 1));
  config.economy.audienceVoteThreshold = Math.max(1, num("audienceVoteThreshold", 3));
  config.economy.audienceCooldownSeconds = Math.max(0, num("audienceCooldownSeconds", 20));
  config.economy.audienceMaxVotesPerRound = Math.max(1, num("audienceMaxVotesPerRound", 1));
  config.economy.tokenCosts = config.economy.tokenCosts || {};
  config.economy.tokenCosts.shield = Math.max(0, num("shieldTokenCost", config.economy.shieldCost));
  config.economy.tokenCosts.mercy = Math.max(0, num("mercyTokenCost", config.economy.mercyCost));
  config.economy.tokenCosts.blessing = Math.max(0, num("blessingTokenCost", config.economy.blessingCost));
  config.economy.tokenCosts.curse = Math.max(0, num("curseTokenCost", config.economy.curseCost));
  config.economy.tokenCosts.chaos = Math.max(0, num("chaosTokenCost", 10));
  config.economy.tokenCosts.guarantee = Math.max(0, num("guaranteeTokenCost", 12));
  config.economy.tokenCosts.immunity = Math.max(0, num("immunityTokenCost", 10));
  config.economy.tokenCosts.doubleShock = Math.max(0, num("doubleShockTokenCost", 10));

  config.fateWheel = (config.fateWheel || []).map(f => {
    let min = Number(document.getElementById(`${f.key}_min`)?.value ?? f.min);
    let max = Number(document.getElementById(`${f.key}_max`)?.value ?? f.max);
    let weight = Number(document.getElementById(`${f.key}_weight`)?.value ?? f.weight);
    let enabled = document.getElementById(`${f.key}_enabled`)?.checked ?? (f.enabled ?? true);
    let escalates = document.getElementById(`${f.key}_escalates`)?.value ?? f.escalates ?? "neutral";
    const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 99)));
    min = Math.max(0, Math.min(maxShock, Math.round(Number.isFinite(min) ? min : f.min)));
    max = Math.max(0, Math.min(maxShock, Math.round(Number.isFinite(max) ? max : f.max)));
    if (max < min) [min, max] = [max, min];
    weight = Math.max(0, Math.round(Number.isFinite(weight) ? weight : f.weight));
    return { ...f, min, max, weight, enabled, escalates };
  });
  updateConfigPreview(false);
  return config;
}

function num(id, fallback) {
  const v = Number(document.getElementById(id).value);
  return Number.isFinite(v) ? v : fallback;
}

async function saveConfig() {
  collectFormToConfig();
  const res = await fetch("/api/config", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(config)
  });
  const data = await res.json();
  if (!res.ok) {
    log("Config save failed: " + (data.error || JSON.stringify(data)));
    return;
  }
  config = data.config;
  log("Saved config.json.");
  loadPlayerObjectivePanel();
}

function updateConfigPreview(collect=true) {
  if (!config) return;
  const preview = document.getElementById("configPreview");
  if (preview) {
    const clone = collect ? collectPreviewOnly() : JSON.parse(JSON.stringify(config));
    preview.value = JSON.stringify(clone, null, 2);
  }
  renderFateOdds();
  updateStats();
}

function collectPreviewOnly() {
  const clone = JSON.parse(JSON.stringify(config));
  try {
    clone.targetWheel.playerWeight = num("playerWeight", clone.targetWheel.playerWeight);
    clone.targetWheel.safeWeight = num("safeWeight", clone.targetWheel.safeWeight);
    clone.targetWheel.shockAllWeight = num("shockAllWeight", clone.targetWheel.shockAllWeight);
    clone.game.hiddenDoubleHitChancePercent = num("doubleHitChance", clone.game.hiddenDoubleHitChancePercent);
    clone.game.pauseBeforeFateMinMs = num("pauseMinMs", clone.game.pauseBeforeFateMinMs);
    clone.game.pauseBeforeFateMaxMs = num("pauseMaxMs", clone.game.pauseBeforeFateMaxMs);
    clone.game.preHitDelayMinMs = num("hitDelayMinMs", clone.game.preHitDelayMinMs);
    clone.game.preHitDelayMaxMs = num("hitDelayMaxMs", clone.game.preHitDelayMaxMs);
    clone.game.doubleHitDelayMinMs = num("doubleDelayMinMs", clone.game.doubleHitDelayMinMs);
    clone.game.doubleHitDelayMaxMs = num("doubleDelayMaxMs", clone.game.doubleHitDelayMaxMs);
    clone.game.noRepeatFate = document.getElementById("noRepeatMode").value === "on";
    clone.game.escalationEnabled = document.getElementById("escalationEnabled").value === "on";
    clone.game.escalationPerRound = num("escalationPerRound", clone.game.escalationPerRound);
    clone.eventCards = clone.eventCards || {};
    clone.eventCards.enabled = document.getElementById("eventCardsEnabled").value === "on";
    clone.eventCards.chancePercent = Math.max(0, Math.min(100, num("eventCardChance", clone.eventCards.chancePercent ?? 18)));
    clone.eventCards.displayDurationMs = Math.max(0, numberWithDefault(document.getElementById("eventCardDisplayMs")?.value, clone.eventCards.displayDurationMs ?? 4000));
    clone.playerPages = clone.playerPages || {};
    const playerPagesOn = document.getElementById("playerPagesEnabled").value === "on";
    clone.playerPages.enabled = playerPagesOn;
    delete clone.playerPages.qrCodesEnabled;
    clone.playerPages.autoRefreshMs = Math.max(500, num("playerAutoRefreshMs", clone.playerPages.autoRefreshMs ?? 2000));
    clone.playerPages.useShockerIdAsAccessKey = Boolean(clone.playerPages.useShockerIdAsAccessKey ?? false);
    clone.hostPage = clone.hostPage || {};
    const hostPageOn = document.getElementById("hostPageEnabled").value === "on";
    clone.hostPage.enabled = hostPageOn;
    delete clone.hostPage.qrCodesEnabled;
    delete clone.hostPage.accessKey;
    clone.hostPage.allowManualControl = true;
    clone.audiencePage = clone.audiencePage || {};
    const audiencePageOn = document.getElementById("audiencePageEnabled").value === "on";
    clone.audiencePage.enabled = audiencePageOn;
    delete clone.audiencePage.qrCodesEnabled;
    delete clone.audiencePage.accessKey;
    clone.economy = clone.economy || {};
    clone.economy.objectiveRewardPoints = Math.max(0, num("objectiveRewardPoints", clone.economy.objectiveRewardPoints ?? 3));
    clone.economy.bodyguardRewardPoints = Math.max(0, num("bodyguardRewardPoints", clone.economy.bodyguardRewardPoints ?? 2));
    clone.economy.blessingCost = Math.max(0, num("blessingCost", clone.economy.blessingCost ?? 5));
    clone.economy.curseCost = Math.max(0, num("curseCost", clone.economy.curseCost ?? 5));
    clone.economy.shieldCost = Math.max(0, num("shieldCost", clone.economy.shieldCost ?? 8));
    clone.economy.mercyCost = Math.max(0, num("mercyCost", clone.economy.mercyCost ?? 6));
    clone.economy.audienceTokenGrantAmount = Math.max(1, num("audienceTokenGrantAmount", clone.economy.audienceTokenGrantAmount ?? 1));
    clone.economy.audienceVoteThreshold = Math.max(1, num("audienceVoteThreshold", clone.economy.audienceVoteThreshold ?? 3));
    clone.economy.audienceCooldownSeconds = Math.max(0, num("audienceCooldownSeconds", clone.economy.audienceCooldownSeconds ?? 20));
    clone.economy.audienceMaxVotesPerRound = Math.max(1, num("audienceMaxVotesPerRound", clone.economy.audienceMaxVotesPerRound ?? 1));
    clone.economy.tokenCosts = clone.economy.tokenCosts || {};
    clone.economy.tokenCosts.shield = Math.max(0, num("shieldTokenCost", clone.economy.tokenCosts.shield ?? clone.economy.shieldCost ?? 8));
    clone.economy.tokenCosts.mercy = Math.max(0, num("mercyTokenCost", clone.economy.tokenCosts.mercy ?? clone.economy.mercyCost ?? 6));
    clone.economy.tokenCosts.blessing = Math.max(0, num("blessingTokenCost", clone.economy.tokenCosts.blessing ?? clone.economy.blessingCost ?? 5));
    clone.economy.tokenCosts.curse = Math.max(0, num("curseTokenCost", clone.economy.tokenCosts.curse ?? clone.economy.curseCost ?? 5));
    clone.economy.tokenCosts.chaos = Math.max(0, num("chaosTokenCost", clone.economy.tokenCosts.chaos ?? 10));
    clone.economy.tokenCosts.guarantee = Math.max(0, num("guaranteeTokenCost", clone.economy.tokenCosts.guarantee ?? clone.economy.guaranteeTokenCost ?? clone.economy.guaranteedPickCost ?? 12));
    clone.economy.tokenCosts.immunity = Math.max(0, num("immunityTokenCost", clone.economy.tokenCosts.immunity ?? clone.economy.immunityTokenCost ?? 10));
    clone.economy.tokenCosts.doubleShock = Math.max(0, num("doubleShockTokenCost", clone.economy.tokenCosts.doubleShock ?? clone.economy.doubleShockTokenCost ?? 10));
    clone.safety.defaultDurationMs = num("duration", clone.safety.defaultDurationMs);
    clone.fateWheel = getFateConfig(false);
  } catch {}
  return clone;
}

function renderFateSettings() {
  const host = document.getElementById("fateSettings");
  host.innerHTML = "";

  (config.fateWheel || []).forEach(f => {
    const row = document.createElement("div");
    row.className = "fateGrid";
    row.innerHTML = `
      <label class="toggle" title="Enable/disable this fate during the game">
        <input id="${f.key}_enabled" type="checkbox" ${(f.enabled ?? true) ? "checked" : ""}>
        <span class="toggleText">${(f.enabled ?? true) ? "ON" : "OFF"}</span>
      </label>
      <label class="fateName" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</label>
      <div class="rangePair">
        <input id="${f.key}_min" class="numSmall" type="number" min="0" max="100" value="${f.min}" title="Minimum">
        <input id="${f.key}_max" class="numSmall" type="number" min="0" max="100" value="${f.max}" title="Maximum">
      </div>
      <input id="${f.key}_weight" class="numWeight" type="number" min="0" max="1000" value="${f.weight}" title="Base weight">
      <select id="${f.key}_escalates">
        <option value="down"${f.escalates === "down" ? " selected" : ""}>Down</option>
        <option value="neutral"${f.escalates === "neutral" ? " selected" : ""}>Neutral</option>
        <option value="up"${f.escalates === "up" ? " selected" : ""}>Up</option>
      </select>
    `;
    host.appendChild(row);
  });

  (config.fateWheel || []).forEach(f => {
    [`${f.key}_enabled`, `${f.key}_min`, `${f.key}_max`, `${f.key}_weight`, `${f.key}_escalates`].forEach(id => {
      document.getElementById(id)?.addEventListener("change", (event) => {
        if (id.endsWith("_enabled")) {
          const text = event.target.closest(".toggle")?.querySelector(".toggleText");
          if (text) text.textContent = event.target.checked ? "ON" : "OFF";
        }
        fateDeck = [];
        redrawAllWheels();
        updateConfigPreview();
      });
    });
  });
}

function getFateConfig(escalated=true) {
  let cfg = (config.fateWheel || []).map(f => {
    let min = Number(document.getElementById(`${f.key}_min`)?.value ?? f.min);
    let max = Number(document.getElementById(`${f.key}_max`)?.value ?? f.max);
    let weight = Number(document.getElementById(`${f.key}_weight`)?.value ?? f.weight);
    let escalates = document.getElementById(`${f.key}_escalates`)?.value ?? f.escalates ?? "neutral";
    let enabled = document.getElementById(`${f.key}_enabled`)?.checked ?? (f.enabled ?? true);

    const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 99)));
    min = Math.max(0, Math.min(maxShock, Math.round(Number.isFinite(min) ? min : f.min)));
    max = Math.max(0, Math.min(maxShock, Math.round(Number.isFinite(max) ? max : f.max)));
    if (max < min) [min, max] = [max, min];

    weight = Math.max(0, Math.round(Number.isFinite(weight) ? weight : f.weight));
    if (!enabled) weight = 0;
    return { ...f, min, max, weight, baseWeight: Math.max(0, Math.round(Number.isFinite(Number(document.getElementById(`${f.key}_weight`)?.value)) ? Number(document.getElementById(`${f.key}_weight`)?.value) : f.weight)), enabled, escalates };
  });

  if (!escalated || document.getElementById("escalationEnabled")?.value !== "on") return cfg;

  const perRound = Math.max(0, Number(document.getElementById("escalationPerRound")?.value || 0));
  const shift = roundNumber * perRound;

  cfg = cfg.map(f => {
    let weight = f.weight;
    if (f.escalates === "down") weight = Math.max(0, weight - shift);
    if (f.escalates === "up") weight = weight + shift;
    return { ...f, weight };
  });

  return cfg;
}

function weightedPick(items) {
  const total = items.reduce((sum, i) => sum + Math.max(0, Number(i.weight || 0)), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (const item of items) {
    r -= Math.max(0, Number(item.weight || 0));
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function buildTargetSegments() {
  const playerWeight = Number(document.getElementById("playerWeight").value || 100);
  const segments = activeShockers().map((s, idx) => ({ type:"player", label:s.name, shocker:s, weight:playerWeight, colorIndex:idx }));
  const safeWeight = Number(document.getElementById("safeWeight").value || 0);
  const shockAllWeight = Number(document.getElementById("shockAllWeight").value || 0);

  if (safeWeight > 0) segments.push({ type:"safe", label:"SAFE", weight:safeWeight });
  if (shockAllWeight > 0 && activeShockers().length > 1) segments.push({ type:"all", label:"ALL", weight:shockAllWeight });

  return segments;
}

function getSegmentColor(seg, index, wheelType) {
  const colors = config?.ui?.colors || {};
  if (wheelType === "target") {
    if (seg.type === "safe") return colors.safe || "#188038";
    if (seg.type === "all") return colors.all || "#b00020";
    const playerColors = colors.players || ["#2d6cdf","#8e24aa","#039be5","#00897b","#7cb342","#fb8c00"];
    return playerColors[(seg.colorIndex ?? index) % playerColors.length];
  }
  const fateByKey = colors.fateByKey || {};
  if (seg.key && fateByKey[seg.key]) return fateByKey[seg.key];
  if (seg.key === "deathwish") return colors.deathwish || "#4a0000";
  const fateColors = colors.fate || ["#00acc1","#7cb342","#fdd835","#fb8c00","#e53935","#8e24aa","#4a0000"];
  return fateColors[index % fateColors.length];
}

function drawCanvasWheel(canvas, segments, wheelType) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.46;
  ctx.clearRect(0, 0, w, h);

  if (!segments.length) {
    ctx.fillStyle = "#333";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    return;
  }

  const total = segments.reduce((sum, s) => sum + Math.max(0, Number(s.weight || 0)), 0) || segments.length;
  let start = -Math.PI / 2;

  segments.forEach((seg, i) => {
    const frac = total > 0 ? Math.max(0, Number(seg.weight || 0)) / total : 1 / segments.length;
    const angle = frac * Math.PI * 2;
    const end = start + angle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = getSegmentColor(seg, i, wheelType);
    ctx.fill();

    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 4;
    ctx.stroke();

    if (config?.ui?.showWheelLabels !== false && angle > 0.08) {
      drawSegmentLabel(ctx, seg.label || seg.name, cx, cy, r, start, end);
    }

    start = end;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#eeeeee";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#eee";
  ctx.stroke();
}

function drawSegmentLabel(ctx, text, cx, cy, r, start, end) {
  const mid = (start + end) / 2;
  const angleSize = end - start;
  const label = String(text).length > 16 ? String(text).slice(0, 15) + "…" : String(text);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(mid);

  const fontSize = Math.max(20, Math.min(38, r * angleSize / 4.8));
  ctx.font = `950 ${fontSize}px system-ui, Segoe UI, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(5, fontSize * 0.18);

  let x = r * 0.78;
  let y = 0;

  // Keep labels upright relative to the viewer before the wheel animation is applied.
  const normalized = ((mid % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (normalized > Math.PI / 2 && normalized < Math.PI * 1.5) {
    ctx.rotate(Math.PI);
    ctx.textAlign = "left";
    x = -r * 0.78;
  }

  ctx.strokeText(label, x, y);
  ctx.fillText(label, x, y);
  ctx.restore();
}


function numberWithDefault(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getEventRuntimeConfig() {
  const displayDurationMs = Math.max(0, numberWithDefault(config?.eventCards?.displayDurationMs ?? eventCardsConfig?.displayDurationMs, 4000));
  return {
    enabled: Boolean(config?.eventCards?.enabled ?? eventCardsConfig?.enabled ?? false) && eventCardsConfig?.enabled !== false,
    chancePercent: Math.max(0, Math.min(100, numberWithDefault(config?.eventCards?.chancePercent ?? eventCardsConfig?.chancePercent, 18))),
    displayDurationMs,
    cards: (eventCardsConfig?.cards || []).filter(c => c && c.enabled !== false)
  };
}

function getTriggeredEventDisplayDuration(card) {
  const ec = getEventRuntimeConfig();
  const raw = card?.displayDurationMs ?? card?.durationMs ?? card?.displayMs ?? ec.displayDurationMs;
  const parsed = Math.max(0, numberWithDefault(raw, ec.displayDurationMs || 4000));
  // Real event cards should remain visible long enough to read.
  // Blank/invalid values used to become 0 and made cards flash away instantly.
  return Math.max(1200, parsed || 4000);
}

function rollEventCard(force = false) {
  const ec = getEventRuntimeConfig();

  if (!ec.enabled && !force) {
    log("Event card roll skipped: event cards are disabled.");
    return null;
  }

  if (!ec.cards.length) {
    log("Event card roll skipped: no enabled event cards found.");
    return null;
  }

  const roll = Math.random() * 100;
  if (!force && roll >= ec.chancePercent) {
    log(`Event card roll missed: ${roll.toFixed(1)} >= ${ec.chancePercent}%.`);
    return null;
  }

  const picked = weightedPick(ec.cards.map(c => ({ ...c, weight: Math.max(0, Number(c.weight ?? 1)) })));
  if (force) log(`Event card forced by host. Picked: ${picked.title || picked.id}.`);
  else log(`Event card roll hit: ${roll.toFixed(1)} < ${ec.chancePercent}%. Picked: ${picked.title || picked.id}.`);
  return picked;
}

function getEventEffects(card) {
  if (!card) return [];
  const rawEffects = [];
  if (Array.isArray(card.effects)) rawEffects.push(...card.effects);
  else if (card.effects && typeof card.effects === "object") rawEffects.push(card.effects);

  if (Array.isArray(card.effect)) rawEffects.push(...card.effect);
  else if (card.effect) rawEffects.push(card.effect);

  if (Array.isArray(card.modifiers)) rawEffects.push(...card.modifiers);
  else if (card.modifiers && typeof card.modifiers === "object") rawEffects.push(card.modifiers);

  if (card.type) rawEffects.push({ type: card.type });

  return rawEffects.map(effect => {
    if (!effect) return null;
    if (typeof effect === "string") return { type: effect };
    if (typeof effect !== "object") return null;
    const type = effect.type || effect.name || effect.action || effect.effectType;
    if (!type) return null;
    return { ...effect, type: String(type) };
  }).filter(Boolean);
}

function cardAffects(card, wheel) {
  const effects = getEventEffects(card);
  if (wheel === "target" && card?.targetWheel) return true;
  if (wheel === "fate" && card?.fateWheel) return true;

  const targetEffects = [
    "manualTargetByLastShocked", "manualTargetByHost", "excludeLastTarget", "excludeLastShocked",
    "forcePreviousTarget", "forceLastShockedTarget", "doubleTarget", "addRandomTargets", "forceAllTargets",
    "forceLeastShockedTarget", "forceMostShockedTarget", "forceLeastSelectedTarget", "forceMostSelectedTarget",
    "forceLeastVibedTarget", "forceMostVibedTarget", "forceLowestIntensityTarget", "forceHighestIntensityTarget",
    "forceLongestNotSelectedTarget", "forceLongestNotShockedTarget", "forceTargetBySelector",
    "multiplyTargetWeight", "disableTargetType", "sharePain", "bodyguard", "duel", "groupVoteTarget",
    "chooseTargetByTarget", "targetChoosesOpponent"
  ];
  const fateEffects = [
    "forceVibrateOnly", "forceControlType", "disableFate", "multiplyFateWeight", "capFateMax",
    "capFateCategory", "doubleSafeWeight", "disableSafe", "noMercy", "mercyRound", "forceFate",
    "equalFateWeights", "invertFateWeights", "forceRandomFate", "chooseFateByTarget", "guaranteedDoubleHit",
    "setDoubleHitChance", "valueMultiplier", "valueOffset", "lastWords"
  ];

  return effects.some(e => {
    const t = String(e.type || "");
    if (wheel === "target") return targetEffects.includes(t);
    if (wheel === "fate") return fateEffects.includes(t);
    return false;
  });
}

function showEventOverlay(card, phaseText="Event card triggered") {
  if (!eventOverlay) return;
  eventTitle.textContent = card?.title || "Event Card";
  eventDescription.textContent = card?.description || card?.text || "A round modifier has appeared.";
  eventPickerLine.textContent = phaseText;
  eventOptions.innerHTML = "";
  eventResult.textContent = "";
  eventContinueBtn.hidden = true;
  eventOverlay.hidden = false;
  eventOverlay.classList.add("show");
  eventCardBox.classList.toggle("affectsTarget", cardAffects(card, "target") && !cardAffects(card, "fate"));
  eventCardBox.classList.toggle("affectsFate", cardAffects(card, "fate") && !cardAffects(card, "target"));
  eventCardBox.classList.toggle("affectsBoth", cardAffects(card, "target") && cardAffects(card, "fate"));
  targetWheel.closest(".wheelCard")?.classList.toggle("eventAffected", cardAffects(card, "target"));
  fateWheel.closest(".wheelCard")?.classList.toggle("eventAffected", cardAffects(card, "fate"));
}

function hideEventOverlay() {
  if (!eventOverlay) return;
  eventOverlay.classList.remove("show");
  eventOverlay.hidden = true;
  eventOptions.innerHTML = "";
  targetWheel.closest(".wheelCard")?.classList.remove("eventAffected");
  fateWheel.closest(".wheelCard")?.classList.remove("eventAffected");
}

function clearActiveEventCardPanel(stateText = "Waiting for the next event roll...") {
  activeRoundEvent = null;
  updateEventCardPanel(null, stateText);
  hideEventOverlay();
}

function waitForEventContinue(ms) {
  return new Promise(resolve => {
    const delayMs = Math.max(0, Number(ms || 0));

    // A value of 0 used to show the continue button but never start a timer,
    // which could leave the round stuck on "Checking for event card...".
    // Treat 0/blank/invalid as "do not pause for the overlay".
    if (!delayMs || !eventContinueBtn) {
      if (eventContinueBtn) {
        eventContinueBtn.hidden = true;
        eventContinueBtn.onclick = null;
      }
      resolve();
      return;
    }

    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      eventContinueBtn.onclick = null;
      eventContinueBtn.hidden = true;
      resolve();
    };
    eventContinueBtn.hidden = false;
    eventContinueBtn.onclick = finish;
    timer = setTimeout(finish, delayMs);
  });
}

function showEventResult(text) {
  eventResult.textContent = text || "";
  if (text) log(`Event result: ${text}`);
}

function choiceButtons(options, onPick) {
  eventOptions.innerHTML = "";
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eventOptionButton";
    btn.textContent = opt.label;
    btn.onclick = () => onPick(opt);
    eventOptions.appendChild(btn);
  });
}

function selectManualTarget(card, picker) {
  return new Promise(resolve => {
    const active = activeShockers();
    if (!active.length) return resolve(null);
    const pickerName = picker?.name || "Host";
    eventPickerLine.textContent = `${pickerName} must pick the next target.`;
    choiceButtons(active.map(s => ({ label: s.name, shocker: s })), opt => {
      const picked = { type: "player", label: opt.shocker.name, shocker: opt.shocker, weight: 1 };
      showEventResult(`${pickerName} picked ${opt.shocker.name}. Target spinner skipped.`);
      resolve(picked);
    });
  });
}


function selectPlayerOption({ pickerName = "Host", prompt = "Pick a player.", candidates = activeShockers(), allowNone = false, noneLabel = "No one" } = {}) {
  return new Promise(resolve => {
    const active = (candidates || []).filter(Boolean);
    eventPickerLine.textContent = prompt.replace("{picker}", pickerName);
    const options = active.map(s => ({ label: s.name, shocker: s }));
    if (allowNone) options.push({ label: noneLabel, shocker: null });
    if (!options.length) return resolve(null);
    choiceButtons(options, opt => {
      resolve(opt.shocker || null);
    });
  });
}

function forceTargetFromShocker(roundState, shocker, labelPrefix = "Target") {
  if (!shocker) return false;
  roundState.forcedTarget = { type: "player", label: shocker.name, shocker, weight: 1 };
  showEventResult(`${labelPrefix}: ${shocker.name}. Target spinner skipped.`);
  return true;
}

async function resolveInteractiveEvent(card, roundState) {
  const effects = getEventEffects(card);
  for (const effect of effects) {
    if (effect.type === "manualTargetByLastShocked") {
      const picker = lastShockedTargets[0];
      if (!picker) {
        showEventResult("No previous shocked player found. Card has no effect this round.");
        continue;
      }
      roundState.forcedTarget = await selectManualTarget(card, picker);
    }
    if (effect.type === "manualTargetByHost" || effect.type === "groupVoteTarget") {
      const pickerName = effect.type === "groupVoteTarget" ? "The group" : "Host";
      roundState.forcedTarget = await selectManualTarget(card, { name: pickerName });
    }
  }
}

async function runPreRoundEvent(pendingRoundModifiers = []) {
  clearActiveEventCardPanel("Checking for event card...");

  const forceEventMod = (pendingRoundModifiers || []).find(m => m && m.type === "forceEventNextRound");
  const card = rollEventCard(Boolean(forceEventMod));

  const roundState = {
    card,
    forcedTarget: null,
    extraTargets: [],
    forceValue: null,
    forceFateKey: null,
    capFateMax: null,
    disabledFateKeys: new Set(),
    fateMultipliers: new Map(),
    targetMultipliers: [],
    excludeTargetIds: new Set(),
    disableTargetTypes: new Set(),
    skipTargetSpin: false,
    doubleHitChanceOverride: null,
    valueMultiplier: 1,
    valueOffset: 0,
    forceAllTargets: false,
    postTargetEffects: [],
    consumedModifierIds: new Set(),
    guaranteedTargets: []
  };

  if (forceEventMod) markRoundModifierConsumed(roundState, forceEventMod, "forced event card");
  if (!card) {
    clearActiveEventCardPanel("No event card this round.");
    return roundState;
  }
  activeRoundEvent = card;
  updateEventCardPanel(card);
  showEventOverlay(card);
  const eventEffects = getEventEffects(card);
  log(`Round ${roundNumber}: Event card triggered: ${card.title || card.id}${eventEffects.length ? ` (${eventEffects.map(e => e.type).join(", ")})` : " (no parsed effects)"}`);
  postEventLog({ roundNumber, type: "eventCardTriggered", title: card.title || card.id, description: card.description || card.text || "", metadata: { card, effects: eventEffects } });
  if (!eventEffects.length) showEventResult("This card has no parsed effects. Check event-cards.json for an effects array or type value.");
  await resolveInteractiveEvent(card, roundState);
  applyEventEffects(card, roundState);
  activeRoundEvent = roundState.card || card;
  updateEventCardPanel(activeRoundEvent);
  await waitForEventContinue(getTriggeredEventDisplayDuration(activeRoundEvent));
  hideEventOverlay();
  setMainResult("Preparing target spin...");
  return roundState;
}

function normalizeFateCap(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const match = (config.fateWheel || []).find(f => f.key === value || String(f.name).toLowerCase() === String(value).toLowerCase());
    return match ? Number(match.max) : null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function applyEventEffects(card, roundState) {
  for (const effect of getEventEffects(card)) {
    const originalType = String(effect.type || "");
    if (["removeSafe", "removeSAFE", "disableSafeTarget", "disableTargetSafe", "noSafeTarget"].includes(originalType)) effect.type = "disableSafe";
    if (["forceVibe", "vibeOnly", "vibrateOnly"].includes(originalType)) effect.type = "forceVibrateOnly";
    if (effect.type === "forceVibrateOnly" || (effect.type === "forceControlType" && String(effect.controlType || effect.value || "").toLowerCase() === "vibrate")) {
      roundState.forceValue = 0;
      roundState.forceFateKey = effect.fateKey || "vibe";
      showEventResult("Fate result forced to VIBE.");
    }

    if (["disableSafe", "noMercy"].includes(effect.type)) {
      roundState.disableTargetTypes.add("safe");
      roundState.disabledFateKeys.add("safe");
      showEventResult("SAFE-style outcomes are disabled for this round where applicable.");
    }

    if (effect.type === "disableTargetType") roundState.disableTargetTypes.add(effect.targetType || effect.value);
    if (effect.type === "doubleSafeWeight") roundState.targetMultipliers.push({ targetType: "safe", multiplier: 2 });
    if (effect.type === "multiplyTargetWeight") roundState.targetMultipliers.push(effect);

    if (effect.type === "multiplyFateWeight") roundState.fateMultipliers.set(effect.fateKey || effect.fateId, Number(effect.multiplier || 1));
    if (effect.type === "disableFate") roundState.disabledFateKeys.add(effect.fateKey || effect.fateId);
    if (effect.type === "equalFateWeights") roundState.equalFateWeights = true;
    if (effect.type === "invertFateWeights") roundState.invertFateWeights = true;
    if (effect.type === "forceRandomFate") roundState.forceRandomFateKeys = effect.fateKeys || effect.fateIds || effect.values || [];

    if (["capFateMax", "capFateCategory", "mercyRound"].includes(effect.type)) {
      const cap = normalizeFateCap(effect.max ?? effect.value ?? effect.maxValue ?? (effect.type === "mercyRound" ? "medium" : null));
      if (cap !== null) {
        roundState.capFateMax = roundState.capFateMax === null ? cap : Math.min(roundState.capFateMax, cap);
        showEventResult(`Fate capped at ${roundState.capFateMax}.`);
      }
    }

    if (effect.type === "forceFate") roundState.forceFateKey = effect.fateKey || effect.fateId || effect.value;
    if (effect.type === "excludeLastTarget") lastSelectedTargets.forEach(s => roundState.excludeTargetIds.add(s.id));
    if (effect.type === "excludeLastShocked") lastShockedTargets.forEach(s => roundState.excludeTargetIds.add(s.id));
    if (effect.type === "forcePreviousTarget" && lastSelectedTargets[0]) forceTargetFromShocker(roundState, lastSelectedTargets[0], "Previous target");
    if (effect.type === "forceLastShockedTarget" && lastShockedTargets[0]) forceTargetFromShocker(roundState, lastShockedTargets[0], "Last shocked player");
    if (effect.type === "forceLeastShockedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("shocked", "least", roundState.excludeTargetIds), "Least shocked player");
    if (effect.type === "forceMostShockedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("shocked", "most", roundState.excludeTargetIds), "Most shocked player");
    if (effect.type === "forceLeastSelectedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("selected", "least", roundState.excludeTargetIds), "Least selected player");
    if (effect.type === "forceMostSelectedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("selected", "most", roundState.excludeTargetIds), "Most selected player");
    if (effect.type === "forceLeastVibedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("vibes", "least", roundState.excludeTargetIds), "Least vibed player");
    if (effect.type === "forceMostVibedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("vibes", "most", roundState.excludeTargetIds), "Most vibed player");
    if (effect.type === "forceLowestIntensityTarget") forceTargetFromShocker(roundState, pickPlayerByStat("totalIntensity", "least", roundState.excludeTargetIds), "Lowest total intensity player");
    if (effect.type === "forceHighestIntensityTarget") forceTargetFromShocker(roundState, pickPlayerByStat("totalIntensity", "most", roundState.excludeTargetIds), "Highest total intensity player");
    if (effect.type === "forceLongestNotSelectedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("roundsSinceSelected", "most", roundState.excludeTargetIds), "Longest not selected player");
    if (effect.type === "forceLongestNotShockedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("roundsSinceShocked", "most", roundState.excludeTargetIds), "Longest not shocked player");
    if (effect.type === "forceTargetBySelector") forceTargetFromShocker(roundState, pickPlayerBySelector(effect.selector, roundState.excludeTargetIds), effect.labelPrefix || "Selected player");
    if (effect.type === "forceAllTargets") {
      roundState.forcedTarget = { type: "all", label: "ALL", weight: 1 };
      showEventResult("Everyone is selected. Target spinner skipped.");
    }
    if (effect.type === "doubleTarget") roundState.extraRandomTargets = Math.max(roundState.extraRandomTargets || 0, 1);
    if (effect.type === "addRandomTargets") roundState.extraRandomTargets = Math.max(roundState.extraRandomTargets || 0, Math.max(1, Number(effect.count || 1)));

    if (["sharePain", "bodyguard", "duel", "chooseFateByTarget", "chooseTargetByTarget", "targetChoosesOpponent", "lastWords"].includes(effect.type)) {
      roundState.postTargetEffects.push(effect);
    }

    if (effect.type === "guaranteedDoubleHit") roundState.doubleHitChanceOverride = 100;
    if (effect.type === "setDoubleHitChance") roundState.doubleHitChanceOverride = Math.max(0, Math.min(100, Number(effect.percent ?? effect.value ?? 0)));
    if (effect.type === "valueMultiplier") roundState.valueMultiplier = Number(effect.multiplier ?? effect.value ?? 1);
    if (effect.type === "valueOffset") roundState.valueOffset = Number(effect.offset ?? effect.value ?? 0);
  }
}

function segmentMatchesTargetMultiplier(segment, effect) {
  if (!segment || !effect) return false;
  if (effect.targetType && segment.type !== effect.targetType) return false;
  if (effect.targetId && segment.shocker?.id !== effect.targetId) return false;
  if (effect.selector === "lastSelected") return segment.shocker && lastSelectedTargets.some(s => s.id === segment.shocker.id);
  if (effect.selector === "lastShocked") return segment.shocker && lastShockedTargets.some(s => s.id === segment.shocker.id);
  if (effect.selector === "leastShocked") {
    const p = pickPlayerByStat("shocked", "least");
    return segment.shocker?.id === p?.id;
  }
  if (effect.selector === "leastSelected") {
    const p = pickPlayerByStat("selected", "least");
    return segment.shocker?.id === p?.id;
  }
  if (effect.selector === "mostSelected") {
    const p = pickPlayerByStat("selected", "most");
    return segment.shocker?.id === p?.id;
  }
  if (effect.selector === "mostShocked") {
    const p = pickPlayerByStat("shocked", "most");
    return segment.shocker?.id === p?.id;
  }
  if (["leastVibed", "mostVibed", "lowestIntensity", "highestIntensity", "longestNotSelected", "longestNotShocked"].includes(effect.selector)) {
    const p = pickPlayerBySelector(effect.selector);
    return segment.shocker?.id === p?.id;
  }
  return Boolean(effect.targetType || effect.targetId);
}

function buildTargetSegmentsForRound(roundState) {
  let segments = buildTargetSegments();
  // Bodyguard modifiers are intentionally NOT applied to the wheel labels/segments here.
  // The wheel should still visibly land on the originally selected protected player.
  // The redirect is applied after the spin, so the result text can show:
  // "Original selected → Bodyguard takes the hit."
  if (roundState?.disableTargetSafe) segments = segments.filter(s => s.type !== "safe");
  if (roundState?.disableTargetTypes?.size) segments = segments.filter(s => !roundState.disableTargetTypes.has(s.type));
  if (roundState?.excludeTargetIds?.size) segments = segments.filter(s => s.type !== "player" || !roundState.excludeTargetIds.has(s.originalShocker?.id || s.shocker.id));
  if (roundState?.forceEqualTargetWeights) {
    segments = segments.map(s => s.type === "player" ? { ...s, weight: 1 } : s);
  }
  if (roundState?.safeWeightMultiplier) {
    segments = segments.map(s => s.type === "safe" ? { ...s, weight: Math.max(0, Number(s.weight || 0)) * roundState.safeWeightMultiplier } : s);
  }
  if (roundState?.targetMultipliers?.length) {
    segments = segments.map(seg => {
      let weight = Number(seg.weight || 0);
      for (const effect of roundState.targetMultipliers) {
        if (segmentMatchesTargetMultiplier(seg, effect)) weight *= Number(effect.multiplier ?? 1);
      }
      return { ...seg, weight: Math.max(0, Math.round(weight)) };
    });
  }
  return segments.filter(s => Number(s.weight || 0) > 0);
}

function getFateConfigForRound(roundState) {
  let cfg = getFateConfig(true).map(f => ({ ...f }));
  if (roundState?.disabledFateKeys?.size) cfg = cfg.filter(f => !roundState.disabledFateKeys.has(f.key));
  if (roundState?.capFateMax !== null && roundState?.capFateMax !== undefined) {
    const max = Number(roundState.capFateMax);
    if (Number.isFinite(max)) cfg = cfg.map(f => ({ ...f, max: Math.min(f.max, max), weight: f.min > max ? 0 : f.weight })).filter(f => f.weight > 0);
  }
  if (roundState?.fateMultipliers?.size) {
    cfg = cfg.map(f => roundState.fateMultipliers.has(f.key) ? { ...f, weight: Math.max(0, Math.round(f.weight * Number(roundState.fateMultipliers.get(f.key) || 1))) } : f);
  }
  if (roundState?.equalFateWeights) cfg = cfg.map(f => ({ ...f, weight: f.weight > 0 ? 1 : 0 }));
  if (roundState?.invertFateWeights) {
    const active = cfg.filter(f => f.weight > 0);
    const maxWeight = Math.max(...active.map(f => f.weight), 1);
    cfg = cfg.map(f => ({ ...f, weight: f.weight > 0 ? Math.max(1, maxWeight - f.weight + 1) : 0 }));
  }
  return cfg;
}

function pickFateFromConfigWithNoRepeat(cfg, label = "round") {
  const activeCfg = (cfg || []).filter(f => f.weight > 0);
  if (!activeCfg.length) return getFateConfig(false)[0];
  if (document.getElementById("noRepeatMode").value === "on") {
    const activeKeys = new Set(activeCfg.map(f => f.key));
    fateDeck = (fateDeck || []).filter(f => f && activeKeys.has(f.key));
    if (!fateDeck.length) resetFateDeckForConfig(activeCfg, label);
    return fateDeck.pop() || weightedPick(activeCfg);
  }
  return weightedPick(activeCfg);
}

function pickFateForRound(roundState) {
  const forcedKey = roundState?.forceFateKey;
  const cfg = getFateConfigForRound(roundState).filter(f => f.weight > 0);
  if (roundState?.forceRandomFateKeys?.length) {
    const allowed = cfg.filter(f => roundState.forceRandomFateKeys.includes(f.key) || roundState.forceRandomFateKeys.includes(f.name));
    if (allowed.length) return allowed[Math.floor(Math.random() * allowed.length)];
  }
  if (forcedKey !== null && forcedKey !== undefined) {
    const forced = cfg.find(f => f.key === forcedKey || f.name === forcedKey || Number(forcedKey) === f.min);
    if (forced) return forced;
  }
  if (!cfg.length) return getFateConfig(false)[0];

  return pickFateFromConfigWithNoRepeat(cfg, roundState?.card ? `event ${roundState.card.id || roundState.card.title || "card"}` : "standard round");
}

function redrawAllWheels() {
  if (!config) return;
  const targets = buildTargetSegments();
  const fate = getFateConfig(true).filter(f => f.weight > 0);
  drawCanvasWheel(targetWheel, targets, "target");
  drawCanvasWheel(fateWheel, fate, "fate");
  spinBtn.disabled = activeShockers().length === 0;
  renderFateOdds();
  updateStats();
}

function renderFateOdds() {
  const host = document.getElementById("fateOdds");
  if (!host || !config) return;

  const cfg = getFateConfig(false);
  const activeCfg = getFateConfig(true).filter(f => f.enabled !== false && f.weight > 0);
  const total = activeCfg.reduce((s, f) => s + f.weight, 0) || 1;

  host.innerHTML = "";

  cfg.forEach(f => {
    const active = f.enabled !== false && activeCfg.some(a => a.key === f.key);
    const activeItem = activeCfg.find(a => a.key === f.key);
    const pct = active && activeItem ? `${((activeItem.weight / total) * 100).toFixed(1)}%` : "OFF";

    const left = document.createElement("div");
    left.textContent = `${f.name} (${f.min}-${f.max})`;
    const right = document.createElement("div");
    right.textContent = pct;
    right.style.fontWeight = "800";

    if (!active) {
      left.className = "disabledOdds";
      right.className = "disabledOdds";
    }

    host.appendChild(left);
    host.appendChild(right);
  });
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

async function savePlayerMultipliers() {
  try {
    await fetch("/api/player-multipliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerMultipliers })
    });
    saveSessionState("player multiplier update");
  } catch (err) {
    log(`Could not save player multipliers: ${err.message}`);
  }
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

async function loadShockers({ preserveSession = true, forceRefresh = false } = {}) {
  targetResult.textContent = forceRefresh ? "Refreshing collars from OpenShock..." : "Loading collars...";
  const res = await fetch(`/api/shockers${forceRefresh ? "?refresh=1" : ""}`);
  const data = await res.json();
  shockers = data.shockers || [];
  ensureAllPlayerStats();

  if (!preserveSession) {
    eliminated.clear();
    if (config?.game?.autoResetEscalationOnReload !== false) resetGame(false, { save: false });
  } else {
    eliminated = new Set(Array.from(eliminated).filter(id => shockers.some(s => s.id === id)));
    lastSelectedTargets = lastSelectedTargets.filter(s => shockers.some(current => current.id === s.id));
    lastShockedTargets = lastShockedTargets.filter(s => shockers.some(current => current.id === s.id));
  }

  const cacheNote = data.cached ? "cached" : "live";
  document.getElementById("sourcePill").textContent = `${data.shockers.length} shockers · ${cacheNote}`;
  renderPlayers();
  redrawAllWheels();
  targetResult.textContent = shockers.length ? `${shockers.length} collars loaded` : "No collars found";
  fateResult.textContent = "Waiting...";
  if (roundNumber === 0) setMainResult("Ready");
  if (data.warning) log(data.warning);
  saveSessionState("shocker reload");
}

function describeValue(v) {
  return v === 0 ? "VIBE (0)" : `SHOCK ${v}`;
}

function formatTargetResultText(targetPicked, targets) {
  const actualNames = (targets || []).filter(Boolean).map(s => s.name).join(" + ");

  if (targetPicked?.bodyguardRedirect) {
    const originalName = targetPicked.originalShocker?.name || targetPicked.label || "Original target";
    const bodyguardName = targetPicked.bodyguardShocker?.name || actualNames || "Bodyguard";

    if (targetPicked.type === "all") {
      return `SHOCK ALL selected · ${originalName} protected by ${bodyguardName}; actual targets: ${actualNames}`;
    }

    return `${originalName} selected → ${bodyguardName} takes the hit`;
  }

  if (targetPicked?.type === "all") return "SHOCK ALL selected";
  if ((targets || []).length > 1) return `${actualNames} selected`;
  return `${actualNames || targetPicked?.label || "Target"} selected`;
}

function pickStrengthFromFate(fate) {
  if (fate.min === 0 && fate.max === 0) return 0;
  return randInt(fate.min, fate.max);
}

function resetFateDeckForConfig(cfg, label = "") {
  fateDeck = [];
  (cfg || []).filter(f => f.weight > 0).forEach(f => {
    const count = Math.max(0, Math.round(f.weight));
    for (let i = 0; i < count; i++) fateDeck.push(f);
  });
  fateDeck = shuffle(fateDeck);
  log(`No-repeat fate deck reset with ${fateDeck.length} weighted entries${label ? ` (${label})` : ""}.`);
}

function resetFateDeck() {
  resetFateDeckForConfig(getFateConfig(true));
}

function pickFate() {
  const cfg = getFateConfig(true).filter(f => f.weight > 0);
  if (!cfg.length) return getFateConfig(false)[0];

  if (document.getElementById("noRepeatMode").value === "on") {
    if (!fateDeck.length) resetFateDeck();
    return fateDeck.pop() || weightedPick(cfg);
  }

  return weightedPick(cfg);
}

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

function spinWheelToSegment(canvas, segments, picked, rotationVarName) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, Number(s.weight || 0)), 0) || segments.length;
  const needleDeg = config?.ui?.selectedNeedleAngleDeg ?? -90; // top pointer
  let startDeg = -90;
  let pickedStart = -90;
  let pickedEnd = 270;

  for (const seg of segments) {
    const deg = (Math.max(0, Number(seg.weight || 0)) / total) * 360;
    const same =
      seg === picked ||
      (seg.key && picked.key && seg.key === picked.key) ||
      (seg.type && picked.type && seg.type === picked.type && seg.label === picked.label);
    if (same) {
      pickedStart = startDeg;
      pickedEnd = startDeg + deg;
      break;
    }
    startDeg += deg;
  }

  const midDeg = (pickedStart + pickedEnd) / 2;
  const desiredRotationMod = normalizeDeg(needleDeg - midDeg);
  const currentRotation = rotationVarName === "target" ? targetRotation : fateRotation;
  const currentMod = normalizeDeg(currentRotation);
  const deltaToTarget = normalizeDeg(desiredRotationMod - currentMod);
  const fullSpins = 1440; // 4 complete spins
  const finalRotation = currentRotation + fullSpins + deltaToTarget;

  const spinMs = config?.ui?.wheelSpinMs ?? 4200;
  canvas.style.transitionDuration = spinMs + "ms";

  if (rotationVarName === "target") {
    targetRotation = finalRotation;
    canvas.style.transform = `rotate(${targetRotation}deg)`;
  } else {
    fateRotation = finalRotation;
    canvas.style.transform = `rotate(${fateRotation}deg)`;
  }
}


async function resolvePostTargetEffects(roundState, targetPicked, targets) {
  if (!roundState?.postTargetEffects?.length) return { targetPicked, targets };
  const primary = targets[0] || targetPicked?.shocker || null;

  for (const effect of roundState.postTargetEffects) {
    if (effect.type === "lastWords") {
      showEventOverlay(roundState.card, `${primary?.name || "Target"} gets last words. Continue when ready.`);
      await waitForEventContinue(Number(effect.durationMs || 0));
      hideEventOverlay();
    }

    if (effect.type === "sharePain" || effect.type === "chooseTargetByTarget") {
      const pickerName = primary?.name || "Target";
      showEventOverlay(roundState.card, `${pickerName} must choose another player.`);
      const candidates = activeShockers().filter(s => !targets.some(t => t.id === s.id));
      const picked = await selectPlayerOption({
        pickerName,
        prompt: `${pickerName} must choose another player to join them.`,
        candidates,
        allowNone: effect.allowNone === true,
        noneLabel: "No extra target"
      });
      if (picked) {
        targets.push(picked);
        showEventResult(`${pickerName} picked ${picked.name}.`);
      } else {
        showEventResult(`${pickerName} did not pick an extra target.`);
      }
      await waitForEventContinue(Number(effect.displayDurationMs || 1200));
      hideEventOverlay();
    }

    if (effect.type === "bodyguard") {
      showEventOverlay(roundState.card, `Choose a volunteer to replace ${primary?.name || "the target"}.`);
      const candidates = activeShockers().filter(s => !targets.some(t => t.id === s.id));
      const volunteer = await selectPlayerOption({
        pickerName: "Host",
        prompt: `Choose a bodyguard to take ${primary?.name || "the target"}'s place.`,
        candidates,
        allowNone: true,
        noneLabel: "No volunteer"
      });
      if (volunteer) {
        targets = [volunteer];
        targetPicked = {
          type: "player",
          label: primary?.name || targetPicked?.label || "Original target",
          shocker: primary || targetPicked?.shocker,
          weight: 1,
          bodyguardRedirect: true,
          originalShocker: primary || targetPicked?.shocker,
          bodyguardShocker: volunteer
        };
        showEventResult(`${primary?.name || "The target"} was selected. ${volunteer.name} takes the hit instead.`);
      } else {
        showEventResult("No bodyguard volunteered.");
      }
      await waitForEventContinue(Number(effect.displayDurationMs || 1200));
      hideEventOverlay();
    }

    if (effect.type === "duel" || effect.type === "targetChoosesOpponent") {
      const pickerName = primary?.name || "Target";
      showEventOverlay(roundState.card, `${pickerName} must challenge someone.`);
      const candidates = activeShockers().filter(s => s.id !== primary?.id);
      const opponent = await selectPlayerOption({ pickerName, prompt: `${pickerName} must choose an opponent. Random loser gets the fate.`, candidates });
      if (opponent) {
        const loser = Math.random() < 0.5 ? primary : opponent;
        targets = [loser];
        targetPicked = { type: "player", label: loser.name, shocker: loser, weight: 1 };
        showEventResult(`${primary.name} challenged ${opponent.name}. ${loser.name} lost the duel.`);
      } else {
        showEventResult("No opponent available. Duel has no effect.");
      }
      await waitForEventContinue(Number(effect.displayDurationMs || 1800));
      hideEventOverlay();
    }

    if (effect.type === "chooseFateByTarget") {
      const pickerName = primary?.name || "Target";
      const choices = effect.choices || [
        { label: "Low for sure", fateKey: "low" },
        { label: "Spin the fate wheel", fateKey: null }
      ];
      showEventOverlay(roundState.card, `${pickerName} must choose their fate option.`);
      await new Promise(resolve => {
        choiceButtons(choices.map(c => ({ label: c.label || c.fateKey || "Spin", choice: c })), opt => {
          const choice = opt.choice;
          if (choice.fateKey) roundState.forceFateKey = choice.fateKey;
          if (choice.forceValue !== undefined) roundState.forceValue = Number(choice.forceValue);
          if (choice.valueMultiplier !== undefined) roundState.valueMultiplier = Number(choice.valueMultiplier);
          if (choice.valueOffset !== undefined) roundState.valueOffset = Number(choice.valueOffset);
          if (choice.forceRandomFateKeys || choice.fateKeys) roundState.forceRandomFateKeys = choice.forceRandomFateKeys || choice.fateKeys;
          if (choice.doubleHitChance !== undefined) roundState.doubleHitChanceOverride = Number(choice.doubleHitChance);
          showEventResult(`${pickerName} chose: ${choice.label || "custom option"}.`);
          resolve();
        });
      });
      await waitForEventContinue(Number(effect.displayDurationMs || 1200));
      hideEventOverlay();
    }
  }

  return { targetPicked, targets };
}

async function sendControl(shocker, selectedValue) {
  const duration = Number(document.getElementById("duration").value || config?.safety?.defaultDurationMs || 700);
  const res = await fetch("/api/control", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ id: shocker.id, selectedValue, duration, exclusive: true })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || JSON.stringify(data));
  return data.sent;
}

async function activateTargets(targets, value, roundState = null) {
  const appliedById = {};
  for (const s of targets) {
    const appliedValue = applyPlayerMultiplier(value, s.id);
    appliedById[s.id] = appliedValue;
    await sendControl(s, appliedValue);
  }

  const doubleChance = roundState?.doubleHitChanceOverride !== null && roundState?.doubleHitChanceOverride !== undefined
    ? Math.max(0, Math.min(100, Number(roundState.doubleHitChanceOverride)))
    : getPercent("doubleHitChance");
  if (value > 0 && rollPercent(doubleChance)) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Hidden double-hit triggered. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const s of targets) await sendControl(s, appliedById[s.id] ?? applyPlayerMultiplier(value, s.id));
  }
  const forcedDoubleIds = roundState?.forcedDoubleShockTargetIds || new Set();
  const forcedTargets = (targets || []).filter(s => forcedDoubleIds.has(String(s.id)));
  if (value > 0 && forcedTargets.length) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Forced double-shock token triggered for ${forcedTargets.map(s => s.name).join(", ")}. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const s of forcedTargets) await sendControl(s, appliedById[s.id] ?? applyPlayerMultiplier(value, s.id));
    for (const s of forcedTargets) {
      const mod = (roundState.pendingRoundModifiers || []).find(m => m.type === "forcedDoubleShockNextRound" && String(m.targetPlayerId) === String(s.id));
      if (mod) markRoundModifierConsumed(roundState, mod, "forced double shock applied");
    }
  }
  return appliedById;
}

async function spinRound() {
  if (hostSpinPaused) {
    log("Spin blocked: host pause is active.");
    setMainResult("Paused by host");
    return;
  }
  collectFormToConfig();

  spinBtn.disabled = true;
  fateDeck = document.getElementById("noRepeatMode").value === "on" ? fateDeck : [];
  setMainResult("Checking for event card...");
  fateResult.textContent = "Waiting...";
  roundNumber++;

  try {
    let serverPendingRoundModifiers = [];
    try {
      const serverState = await getServerSessionState();
      serverPendingRoundModifiers = Array.isArray(serverState.pendingRoundModifiers) ? serverState.pendingRoundModifiers : [];
    } catch (err) {
      log(`Pending modifier load skipped: ${err.message}`);
    }
    let roundState = await runPreRoundEvent(serverPendingRoundModifiers);
    roundState.pendingRoundModifiers = serverPendingRoundModifiers;
    applyPendingModifiersBeforeTarget(roundState);
    const targetSegments = buildTargetSegmentsForRound(roundState);
    if (!targetSegments.length && !roundState.forcedTarget) {
      roundNumber = Math.max(0, roundNumber - 1);
      targetResult.textContent = "No eligible targets";
      fateResult.textContent = "Round aborted.";
      setMainResult("No eligible targets - round aborted.", "safe");
      log("Round aborted: no eligible targets after filters/modifiers.");
      redrawAllWheels();
      saveSessionState("round aborted - no eligible targets");
      clearActiveEventCardPanel("Round aborted.");
      return;
    }

    redrawAllWheels();
    drawCanvasWheel(targetWheel, targetSegments, "target");

    let targetPicked = roundState.forcedTarget || weightedPick(targetSegments);

    if (roundState.forcedTarget) {
      targetResult.textContent = targetPicked.type === "all"
        ? "ALL manually selected"
        : `${(targetPicked.shockers || [targetPicked.shocker]).filter(Boolean).map(s => s.name).join(" + ")} manually selected`;
      setMainResult(targetResult.textContent, targetPicked.type === "all" ? "all" : "hit");
    } else {
      spinWheelToSegment(targetWheel, targetSegments, targetPicked, "target");
      targetResult.textContent = "Spinning target...";
      setMainResult("Target spinning...");
      await sleep(config?.ui?.wheelSpinMs ?? 4200);
    }

    if (targetPicked.type === "safe") {
      targetResult.textContent = "SAFE";
      fateResult.textContent = "No fate spin.";
      setMainResult("SAFE - Nobody gets hit.", "safe");
      log(`Round ${roundNumber}: SAFE${roundState.card ? ` after event ${roundState.card.title || roundState.card.id}` : ""}`);
      recordSafeRoundForActivePlayers();
      lastSelectedTargets = [];
      lastTargetPicked = targetPicked;
      renderPlayers();
      // Keep the spun target wheel exactly as it was for this round.
      // Redrawing here can use the normal/default wheel config instead of the
      // round-specific segments, which makes the pointer appear to land on the
      // wrong player after modifiers changed wheel weights.
      updateStats();
      await consumeRoundModifiers(consumedRoundModifierIds(roundState));
      await postRoundResult({ roundNumber, eventId: roundState.card?.id || null, eventTitle: roundState.card?.title || null, resultType: "safe", targets: [] });
      saveSessionState("safe round");
      // Keep the active event card banner visible after the round result.
      // It is reset at the start of the next round when the next event roll begins,
      // or replaced by "No event card this round" when the next roll misses.
      return;
    }

    let targets = targetPicked.type === "all"
      ? activeShockers()
      : (targetPicked.type === "multi" ? (targetPicked.shockers || []).filter(Boolean) : [targetPicked.shocker].filter(Boolean));
    if (roundState.extraRandomTargets && targetPicked.type === "player") {
      let candidates = activeShockers().filter(s => !targets.some(t => t.id === s.id));
      for (let i = 0; i < Number(roundState.extraRandomTargets || 0) && candidates.length; i++) {
        const pickedExtra = candidates[Math.floor(Math.random() * candidates.length)];
        targets.push(pickedExtra);
        candidates = candidates.filter(s => s.id !== pickedExtra.id);
      }
    }

    if (roundState.extraTargets?.length) {
      for (const extra of roundState.extraTargets) {
        if (extra?.id && !targets.some(t => t.id === extra.id)) targets.push(extra);
      }
    }

    ({ targetPicked, targets } = applyPendingModifiersAfterTarget(roundState, targetPicked, targets));
    ({ targetPicked, targets } = await resolvePostTargetEffects(roundState, targetPicked, targets));

    const immuneIds = roundState.immuneTargetIds || new Set();
    const beforeImmunity = targets.length;
    targets = targets.filter(t => !immuneIds.has(String(t.id)));
    if (beforeImmunity !== targets.length) {
      for (const id of immuneIds) markRoundModifierConsumed(roundState, { id: (roundState.pendingRoundModifiers || []).find(m => m.type === "immunityNextRound" && String(m.targetPlayerId) === String(id))?.id }, "immunity applied");
      log("Immunity token prevented one or more hits this round.");
    }
    if (!targets.length) {
      targetResult.textContent = "IMMUNITY";
      fateResult.textContent = "No fate spin.";
      setMainResult("IMMUNITY - Hit ignored.", "safe");
      lastSelectedTargets = [];
      lastTargetPicked = { type: "safe", label: "IMMUNITY" };
      await consumeRoundModifiers(consumedRoundModifierIds(roundState));
      await postRoundResult({ roundNumber, eventId: roundState.card?.id || null, eventTitle: roundState.card?.title || null, resultType: "immunity", targets: [] });
      saveSessionState("immunity round");
      return;
    }

    targetResult.textContent = formatTargetResultText(targetPicked, targets);
    setMainResult(targetResult.textContent, targetPicked.type === "all" ? "all" : "hit");

    const pause = randInt(document.getElementById("pauseMinMs").value, document.getElementById("pauseMaxMs").value);
    fateResult.textContent = "Preparing fate...";
    log(`Round ${roundNumber}: ${targetResult.textContent}. Fate starts in ${pause} ms.`);
    await sleep(pause);

    const fateSegments = getFateConfigForRound(roundState).filter(f => f.weight > 0);
    drawCanvasWheel(fateWheel, fateSegments, "fate");
    const fatePicked = pickFateForRound(roundState);
    spinWheelToSegment(fateWheel, fateSegments, fatePicked, "fate");

    fateResult.textContent = "Spinning fate...";
    setMainResult("Calculating fate...");
    await sleep(config?.ui?.wheelSpinMs ?? 4200);

    let value = roundState.forceValue !== null && roundState.forceValue !== undefined
      ? roundState.forceValue
      : pickStrengthFromFate(fatePicked);
    if (value > 0) {
      value = Math.round((value * Number(roundState.valueMultiplier || 1)) + Number(roundState.valueOffset || 0));
      const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 99)));
      value = Math.max(1, Math.min(maxShock, value));
    }
    const previewAppliedById = Object.fromEntries((targets || []).filter(Boolean).map(s => [s.id, applyPlayerMultiplier(value, s.id)]));
    const appliedText = describeAppliedValues(targets, value, previewAppliedById);
    fateResult.textContent = `${fatePicked.name}: ${appliedText}`;
    const mainText = `${formatTargetResultText(targetPicked, targets)} - ${appliedText}`;
    setMainResult(mainText, value === 0 ? "" : (targetPicked.type === "all" ? "all" : "hit"));

    const hitDelay = randInt(document.getElementById("hitDelayMinMs").value, document.getElementById("hitDelayMaxMs").value);
    log(`Round ${roundNumber}: ${mainText}. Activation in ${hitDelay} ms.`);
    await sleep(hitDelay);

    const appliedById = await activateTargets(targets, value, roundState);
    recordRoundTargets(targets, { value, valueByTargetId: appliedById, wasAll: targetPicked.type === "all" });
    if (value > 0) {
      lastShockedTargets = [...targets];
    }
    lastSelectedTargets = [...targets];
    lastTargetPicked = targetPicked;
    log(`Round ${roundNumber}: Activated ${targets.length} target(s). ${describeAppliedValues(targets, value, appliedById)}.`);
    await postRoundResult({
      roundNumber,
      eventId: roundState.card?.id || null,
      eventTitle: roundState.card?.title || null,
      resultType: value > 0 ? "shock" : "vibe",
      targets: (targets || []).map(s => ({ playerId: s.id, deviceId: s.id, name: s.name, rolledValue: value, multiplierPercent: getPlayerMultiplier(s.id), appliedValue: appliedById[s.id] ?? applyPlayerMultiplier(value, s.id) }))
    });
    renderPlayers();
    // Do not redraw the wheels after the round result is shown.
    // The target/fate wheels may have used round-specific weights from cards,
    // curse/chaos/blessing, shield exclusions, etc. A default redraw keeps the
    // old CSS rotation but changes the segments underneath it, causing visual
    // mismatches like the pointer showing Shock 2 while the game selected Shock 3.
    updateStats();
    await consumeRoundModifiers(consumedRoundModifierIds(roundState));
    saveSessionState("round completed");
  } catch (err) {
    setMainResult("Error");
    log(err.message);
    hideEventOverlay();
  } finally {
    // Do not clear the event card banner at round end. The banner should keep
    // showing the event that affected the visible round result. It is only reset
    // when the next round starts checking for a new event, or when that check
    // explicitly finds no event card.
    spinBtn.disabled = false;
  }
}

function eliminateOne() {
  const active = activeShockers();
  if (!active.length) {
    log("No active players to eliminate.");
    return;
  }
  const picked = active[Math.floor(Math.random() * active.length)];
  eliminated.add(picked.id);
  renderPlayers();
  redrawAllWheels();
  log(`Eliminated 1: ${picked.name}`);
  saveSessionState("random elimination");
}

async function stopAll() {
  try {
    const ids = shockers.map(s => s.id);
    await fetch("/api/stop-all", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ ids })
    });
    log("STOP ALL sent.");
  } catch (err) {
    log("STOP failed: " + err.message);
  }
}

async function resetGame(writeLog=true, { save = true, resetServer = false } = {}) {
  let freshServerState = null;

  if (resetServer) {
    const ok = window.confirm("Reset the current game state? The current SQLite session will be archived as JSON with a timestamp.");
    if (!ok) return;

    sessionSaveEnabled = false;
    freshServerState = await resetServerSessionState();
    sessionSaveEnabled = true;

    // Do not clear the visible game if the server-side reset/archive failed.
    if (!freshServerState) return;
  }

  roundNumber = 0;
  fateDeck = [];
  activeRoundEvent = null;
  lastShockedTargets = [];
  lastSelectedTargets = [];
  lastTargetPicked = null;
  eliminated.clear();
  playerStats = {};
  ensureAllPlayerStats();

  if (freshServerState) {
    applySessionSnapshot(freshServerState);
  } else {
    targetResult.textContent = shockers.length ? `${shockers.length} collars loaded` : "No collars found";
    fateResult.textContent = "Waiting...";
    setMainResult("Ready");
    renderPlayers();
    redrawAllWheels();
  }

  if (writeLog) log("Game reset. Escalation round counter back to 0.");
  loadPlayerObjectivePanel();
  if (!resetServer && save) saveSessionState("game reset");
}

[
  "playerWeight","safeWeight","shockAllWeight","doubleHitChance",
  "pauseMinMs","pauseMaxMs","hitDelayMinMs","hitDelayMaxMs",
  "doubleDelayMinMs","doubleDelayMaxMs","duration","noRepeatMode",
  "escalationEnabled","escalationPerRound",
  "eventCardsEnabled","eventCardChance","eventCardDisplayMs",
  "playerPagesEnabled","playerAutoRefreshMs",
  "hostPageEnabled",
  "audiencePageEnabled",
  "objectiveRewardPoints","bodyguardRewardPoints","blessingCost","curseCost","shieldCost","mercyCost",
  "audienceTokenGrantAmount","audienceVoteThreshold","audienceCooldownSeconds","audienceMaxVotesPerRound",
  "shieldTokenCost","mercyTokenCost","blessingTokenCost","curseTokenCost","chaosTokenCost","guaranteeTokenCost"
].forEach(id => {
  document.getElementById(id).addEventListener("change", async () => {
    syncPageQrControls(id);
    redrawAllWheels();
    updateConfigPreview();
    if (["playerPagesEnabled", "hostPageEnabled", "audiencePageEnabled"].includes(id)) {
      await saveConfig();
      log(`${id} saved and applied live.`);
    }
  });
});

document.getElementById("saveConfigBtn").onclick = saveConfig;
document.getElementById("reloadConfigBtn").onclick = async () => { await loadConfig(); renderPlayers(); saveSessionState("config reload"); };
document.getElementById("resetGameBtn").onclick = () => resetGame(true, { resetServer: true });
document.getElementById("spinBtn").onclick = spinRound;
document.getElementById("stopBtn").onclick = stopAll;
document.getElementById("reloadBtn").onclick = () => loadShockers({ preserveSession: true, forceRefresh: true });
document.getElementById("elimOneBtn").onclick = eliminateOne;

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;

  const activeElement = document.activeElement;
  const isTyping =
    activeElement &&
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(activeElement.tagName);

  if (isTyping) return;

  const keyboard = config?.keyboard || {};
  if (keyboard.spinEnabled === false) return;

  const spinKey = keyboard.spinKey || "F13";

  if (event.code === spinKey) {
    event.preventDefault();

    if (!spinBtn.disabled) {
      spinRound();
    }
  }
});

(async function init() {
  updateEventCardPanel(null);
  await loadEventCards();
  await loadConfig();
  await loadShockers({ preserveSession: true });
  await loadSessionState();
  await loadPlayerObjectivePanel();
  startHostCommandPolling();
})();