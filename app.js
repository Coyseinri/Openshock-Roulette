let config = null;
let shockers = [];
let eliminated = new Set();
let targetRotation = 0;
let fateRotation = 0;
let roundNumber = 0;
let fateDeck = [];

const targetWheel = document.getElementById("targetWheel");
const fateWheel = document.getElementById("fateWheel");
const targetResult = document.getElementById("targetResult");
const fateResult = document.getElementById("fateResult");
const mainResult = document.getElementById("mainResult");
const playersDiv = document.getElementById("players");
const spinBtn = document.getElementById("spinBtn");

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
}

function collectFormToConfig() {
  config.targetWheel = config.targetWheel || {};
  config.game = config.game || {};
  config.safety = config.safety || {};

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

    info.appendChild(nameButton);
    info.appendChild(idLine);

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

async function activateTargets(targets, value) {
  for (const s of targets) await sendControl(s, value);

  const doubleChance = getPercent("doubleHitChance");
  if (value > 0 && rollPercent(doubleChance)) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Hidden double-hit triggered. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const s of targets) await sendControl(s, value);
  }
}

async function spinRound() {
  collectFormToConfig();
  const targetSegments = buildTargetSegments();
  if (!targetSegments.length) return;

  spinBtn.disabled = true;
  fateDeck = document.getElementById("noRepeatMode").value === "on" ? fateDeck : [];
  setMainResult("Target spinning...");
  fateResult.textContent = "Waiting...";
  roundNumber++;

  try {
    redrawAllWheels();

    const targetPicked = weightedPick(targetSegments);
    spinWheelToSegment(targetWheel, targetSegments, targetPicked, "target");

    targetResult.textContent = "Spinning target...";
    await sleep(config?.ui?.wheelSpinMs ?? 4200);

    if (targetPicked.type === "safe") {
      targetResult.textContent = "SAFE";
      fateResult.textContent = "No fate spin.";
      setMainResult("SAFE - Nobody gets hit.", "safe");
      log(`Round ${roundNumber}: SAFE`);
      redrawAllWheels();
      return;
    }

    const targets = targetPicked.type === "all" ? activeShockers() : [targetPicked.shocker];
    targetResult.textContent = targetPicked.type === "all" ? "SHOCK ALL selected" : `${targetPicked.shocker.name} selected`;
    setMainResult(targetResult.textContent, targetPicked.type === "all" ? "all" : "hit");

    const pause = randInt(document.getElementById("pauseMinMs").value, document.getElementById("pauseMaxMs").value);
    fateResult.textContent = "Preparing fate...";
    log(`Round ${roundNumber}: ${targetResult.textContent}. Fate starts in ${pause} ms.`);
    await sleep(pause);

    const fateSegments = getFateConfig(true).filter(f => f.weight > 0);
    const fatePicked = pickFate();
    spinWheelToSegment(fateWheel, fateSegments, fatePicked, "fate");

    fateResult.textContent = "Spinning fate...";
    setMainResult("Calculating fate...");
    await sleep(config?.ui?.wheelSpinMs ?? 4200);

    const value = pickStrengthFromFate(fatePicked);
    fateResult.textContent = `${fatePicked.name}: ${describeValue(value)}`;
    const mainText = targetPicked.type === "all"
      ? `ALL - ${describeValue(value)}`
      : `${targetPicked.shocker.name} - ${describeValue(value)}`;
    setMainResult(mainText, value === 0 ? "" : (targetPicked.type === "all" ? "all" : "hit"));

    const hitDelay = randInt(document.getElementById("hitDelayMinMs").value, document.getElementById("hitDelayMaxMs").value);
    log(`Round ${roundNumber}: ${mainText}. Activation in ${hitDelay} ms.`);
    await sleep(hitDelay);

    await activateTargets(targets, value);
    log(`Round ${roundNumber}: Activated ${targets.length} target(s) with ${describeValue(value)}.`);
    redrawAllWheels();
  } catch (err) {
    setMainResult("Error");
    log(err.message);
  } finally {
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
  targetResult.textContent = shockers.length ? `${shockers.length} collars loaded` : "No collars found";
  fateResult.textContent = "Waiting...";
  setMainResult("Ready");
  redrawAllWheels();
  if (writeLog) log("Game reset. Escalation round counter back to 0.");
}

[
  "playerWeight","safeWeight","shockAllWeight","doubleHitChance",
  "pauseMinMs","pauseMaxMs","hitDelayMinMs","hitDelayMaxMs",
  "doubleDelayMinMs","doubleDelayMaxMs","duration","noRepeatMode",
  "escalationEnabled","escalationPerRound"
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
  await loadShockers();
})();