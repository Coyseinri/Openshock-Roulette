// OSR wheel drawing and wheel selection helpers

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
    if (seg.type === "virtual") return colors.virtual || colors.safe || "#188038";
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

function describeValue(v) {
  return v === 0 ? "VIBE (0)" : `SHOCK ${v}`;
}

function formatTargetResultText(targetPicked, targets) {
  if (targetPicked?.type === "virtual") {
    return targetPicked.resultText || `${targetPicked.virtualName || targetPicked.name || targetPicked.label || "Virtual target"} selected`;
  }

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
