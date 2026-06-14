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


function defaultPlayerStats() {
  return {
    selected: 0,              // final selected target count after event-card changes
    shocked: 0,               // actual non-zero OpenShock activations
    vibes: 0,                 // zero-value / vibration rounds
    safe: 0,                  // target spinner SAFE rounds while player was active
    allTargeted: 0,           // times included by SHOCK ALL / forceAllTargets
    totalIntensity: 0,        // sum of non-zero selected values received
    lastSelectedRound: 0,
    lastShockedRound: 0,
    lastVibeRound: 0
  };
}

function ensurePlayerStats(shocker) {
  if (!shocker?.id) return defaultPlayerStats();
  if (!playerStats[shocker.id]) playerStats[shocker.id] = defaultPlayerStats();

  // Backfill new fields when loading an older in-memory game state.
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

function recordRoundTargets(targets, { value = null, wasAll = false } = {}) {
  const uniqueTargets = Array.from(new Map((targets || []).filter(Boolean).map(s => [s.id, s])).values());
  uniqueTargets.forEach(s => {
    const stats = ensurePlayerStats(s);
    stats.selected = Math.max(0, Number(stats.selected || 0)) + 1;
    stats.lastSelectedRound = roundNumber;

    if (wasAll) stats.allTargeted = Math.max(0, Number(stats.allTargeted || 0)) + 1;

    if (Number(value) > 0) {
      stats.shocked = Math.max(0, Number(stats.shocked || 0)) + 1;
      stats.totalIntensity = Math.max(0, Number(stats.totalIntensity || 0)) + Number(value || 0);
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
  document.getElementById("eventCardsEnabled").value = config.eventCards?.enabled ? "on" : "off";
  document.getElementById("eventCardChance").value = config.eventCards?.chancePercent ?? 18;
  document.getElementById("eventCardDisplayMs").value = config.eventCards?.displayDurationMs ?? 4000;
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
  config.eventCards.displayDurationMs = Math.max(0, num("eventCardDisplayMs", 4000));

  config.fateWheel = (config.fateWheel || []).map(f => {
    let min = Number(document.getElementById(`${f.key}_min`)?.value ?? f.min);
    let max = Number(document.getElementById(`${f.key}_max`)?.value ?? f.max);
    let weight = Number(document.getElementById(`${f.key}_weight`)?.value ?? f.weight);
    let enabled = document.getElementById(`${f.key}_enabled`)?.checked ?? (f.enabled ?? true);
    let escalates = document.getElementById(`${f.key}_escalates`)?.value ?? f.escalates ?? "neutral";
    const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 100)));
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
    clone.eventCards.displayDurationMs = Math.max(0, num("eventCardDisplayMs", clone.eventCards.displayDurationMs ?? 4000));
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

    const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 100)));
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
  const fateColors = colors.fate || ["#00acc1","#7cb342","#fdd835","#fb8c00","#e53935","#8e24aa"];
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


function getEventRuntimeConfig() {
  return {
    enabled: Boolean(config?.eventCards?.enabled ?? eventCardsConfig?.enabled ?? false) && eventCardsConfig?.enabled !== false,
    chancePercent: Math.max(0, Math.min(100, Number(config?.eventCards?.chancePercent ?? eventCardsConfig?.chancePercent ?? 18))),
    displayDurationMs: Math.max(0, Number(config?.eventCards?.displayDurationMs ?? eventCardsConfig?.displayDurationMs ?? 4000)),
    cards: (eventCardsConfig?.cards || []).filter(c => c && c.enabled !== false)
  };
}

function rollEventCard() {
  const ec = getEventRuntimeConfig();
  if (!ec.enabled || !ec.cards.length || !rollPercent(ec.chancePercent)) return null;
  return weightedPick(ec.cards.map(c => ({ ...c, weight: Math.max(0, Number(c.weight ?? 1)) })));
}

function getEventEffects(card) {
  if (!card) return [];
  if (Array.isArray(card.effects)) return card.effects.filter(Boolean);
  if (card.type) return [{ type: card.type }];
  return [];
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

function waitForEventContinue(ms) {
  return new Promise(resolve => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      eventContinueBtn.onclick = null;
      resolve();
    };
    eventContinueBtn.hidden = false;
    eventContinueBtn.onclick = finish;
    if (ms > 0) timer = setTimeout(finish, ms);
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

async function runPreRoundEvent() {
  activeRoundEvent = null;
  const card = rollEventCard();
  const roundState = {
    card, forcedTarget: null, extraTargets: [], forceValue: null, forceFateKey: null, capFateMax: null,
    disabledFateKeys: new Set(), fateMultipliers: new Map(), targetMultipliers: [], excludeTargetIds: new Set(),
    disableTargetTypes: new Set(), skipTargetSpin: false, doubleHitChanceOverride: null, valueMultiplier: 1, valueOffset: 0,
    forceAllTargets: false, postTargetEffects: []
  };
  if (!card) return roundState;

  activeRoundEvent = card;
  showEventOverlay(card);
  log(`Round ${roundNumber}: Event card triggered: ${card.title || card.id}`);
  await resolveInteractiveEvent(card, roundState);
  applyEventEffects(card, roundState);
  await waitForEventContinue(getEventRuntimeConfig().displayDurationMs);
  hideEventOverlay();
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
  if (roundState?.disableTargetSafe) segments = segments.filter(s => s.type !== "safe");
  if (roundState?.disableTargetTypes?.size) segments = segments.filter(s => !roundState.disableTargetTypes.has(s.type));
  if (roundState?.excludeTargetIds?.size) segments = segments.filter(s => s.type !== "player" || !roundState.excludeTargetIds.has(s.shocker.id));
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

  if (document.getElementById("noRepeatMode").value === "on" && !roundState?.card) return pickFate();
  return weightedPick(cfg);
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
    };

    row.appendChild(info);
    row.appendChild(btn);
    playersDiv.appendChild(row);
  });
}

async function loadShockers() {
  targetResult.textContent = "Loading collars...";
  const res = await fetch("/api/shockers");
  const data = await res.json();
  shockers = data.shockers || [];
  ensureAllPlayerStats();
  eliminated.clear();
  if (config?.game?.autoResetEscalationOnReload !== false) resetGame(false);
  document.getElementById("sourcePill").textContent = `${data.shockers.length} shockers`;
  renderPlayers();
  redrawAllWheels();
  targetResult.textContent = shockers.length ? `${shockers.length} collars loaded` : "No collars found";
  fateResult.textContent = "Waiting...";
  setMainResult("Ready");
  if (data.warning) log(data.warning);
}

function describeValue(v) {
  return v === 0 ? "VIBE (0)" : `SHOCK ${v}`;
}

function pickStrengthFromFate(fate) {
  if (fate.min === 0 && fate.max === 0) return 0;
  return randInt(fate.min, fate.max);
}

function resetFateDeck() {
  fateDeck = [];
  const cfg = getFateConfig(true);
  cfg.forEach(f => {
    const count = Math.max(0, Math.round(f.weight));
    for (let i = 0; i < count; i++) fateDeck.push(f);
  });
  fateDeck = shuffle(fateDeck);
  log(`No-repeat fate deck reset with ${fateDeck.length} weighted entries.`);
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

  // We need: midDeg + finalRotation = needleDeg  (mod 360)
  // Previous versions added an absolute target each round, causing pointer/result drift.
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
        targetPicked = { type: "player", label: volunteer.name, shocker: volunteer, weight: 1 };
        showEventResult(`${volunteer.name} takes the hit instead.`);
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
  for (const s of targets) await sendControl(s, value);

  const doubleChance = roundState?.doubleHitChanceOverride !== null && roundState?.doubleHitChanceOverride !== undefined
    ? Math.max(0, Math.min(100, Number(roundState.doubleHitChanceOverride)))
    : getPercent("doubleHitChance");
  if (value > 0 && rollPercent(doubleChance)) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Hidden double-hit triggered. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const s of targets) await sendControl(s, value);
  }
}

async function spinRound() {
  collectFormToConfig();

  spinBtn.disabled = true;
  fateDeck = document.getElementById("noRepeatMode").value === "on" ? fateDeck : [];
  setMainResult("Checking for event card...");
  fateResult.textContent = "Waiting...";
  roundNumber++;

  try {
    let roundState = await runPreRoundEvent();
    const targetSegments = buildTargetSegmentsForRound(roundState);
    if (!targetSegments.length && !roundState.forcedTarget) return;

    redrawAllWheels();
    drawCanvasWheel(targetWheel, targetSegments, "target");

    let targetPicked = roundState.forcedTarget || weightedPick(targetSegments);

    if (roundState.forcedTarget) {
      targetResult.textContent = targetPicked.type === "all"
        ? "ALL manually selected"
        : `${targetPicked.shocker.name} manually selected`;
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
      log(`Round ${roundNumber}: SAFE${activeRoundEvent ? ` after event ${activeRoundEvent.title || activeRoundEvent.id}` : ""}`);
      recordSafeRoundForActivePlayers();
      lastSelectedTargets = [];
      lastTargetPicked = targetPicked;
      renderPlayers();
      redrawAllWheels();
      return;
    }

    let targets = targetPicked.type === "all" ? activeShockers() : [targetPicked.shocker];
    if (roundState.extraRandomTargets && targetPicked.type === "player") {
      let candidates = activeShockers().filter(s => !targets.some(t => t.id === s.id));
      for (let i = 0; i < Number(roundState.extraRandomTargets || 0) && candidates.length; i++) {
        const pickedExtra = candidates[Math.floor(Math.random() * candidates.length)];
        targets.push(pickedExtra);
        candidates = candidates.filter(s => s.id !== pickedExtra.id);
      }
    }

    ({ targetPicked, targets } = await resolvePostTargetEffects(roundState, targetPicked, targets));

    targetResult.textContent = targetPicked.type === "all"
      ? "SHOCK ALL selected"
      : targets.length > 1
        ? `${targets.map(s => s.name).join(" + ")} selected`
        : `${targets[0].name} selected`;
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
      const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 100)));
      value = Math.max(1, Math.min(maxShock, value));
    }
    fateResult.textContent = `${fatePicked.name}: ${describeValue(value)}`;
    const mainText = targetPicked.type === "all"
      ? `ALL - ${describeValue(value)}`
      : `${targets.map(s => s.name).join(" + ")} - ${describeValue(value)}`;
    setMainResult(mainText, value === 0 ? "" : (targetPicked.type === "all" ? "all" : "hit"));

    const hitDelay = randInt(document.getElementById("hitDelayMinMs").value, document.getElementById("hitDelayMaxMs").value);
    log(`Round ${roundNumber}: ${mainText}. Activation in ${hitDelay} ms.`);
    await sleep(hitDelay);

    await activateTargets(targets, value, roundState);
    recordRoundTargets(targets, { value, wasAll: targetPicked.type === "all" });
    if (value > 0) {
      lastShockedTargets = [...targets];
    }
    lastSelectedTargets = [...targets];
    lastTargetPicked = targetPicked;
    log(`Round ${roundNumber}: Activated ${targets.length} target(s) with ${describeValue(value)}.`);
    renderPlayers();
    redrawAllWheels();
  } catch (err) {
    setMainResult("Error");
    log(err.message);
    hideEventOverlay();
  } finally {
    activeRoundEvent = null;
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

function resetGame(writeLog=true) {
  roundNumber = 0;
  fateDeck = [];
  activeRoundEvent = null;
  lastShockedTargets = [];
  lastSelectedTargets = [];
  lastTargetPicked = null;
  playerStats = {};
  ensureAllPlayerStats();
  targetResult.textContent = shockers.length ? `${shockers.length} collars loaded` : "No collars found";
  fateResult.textContent = "Waiting...";
  setMainResult("Ready");
  renderPlayers();
  redrawAllWheels();
  if (writeLog) log("Game reset. Escalation round counter back to 0.");
}

[
  "playerWeight","safeWeight","shockAllWeight","doubleHitChance",
  "pauseMinMs","pauseMaxMs","hitDelayMinMs","hitDelayMaxMs",
  "doubleDelayMinMs","doubleDelayMaxMs","duration","noRepeatMode",
  "escalationEnabled","escalationPerRound",
  "eventCardsEnabled","eventCardChance","eventCardDisplayMs"
].forEach(id => {
  document.getElementById(id).addEventListener("change", () => {
    redrawAllWheels();
    updateConfigPreview();
  });
});

document.getElementById("saveConfigBtn").onclick = saveConfig;
document.getElementById("reloadConfigBtn").onclick = async () => { await loadConfig(); renderPlayers(); };
document.getElementById("resetGameBtn").onclick = () => resetGame(true);
document.getElementById("spinBtn").onclick = spinRound;
document.getElementById("stopBtn").onclick = stopAll;
document.getElementById("reloadBtn").onclick = loadShockers;
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
  await loadConfig();
  await loadEventCards();
  await loadShockers();
})();