
function getShockerGroupingConfig() {
  const cfg = config?.shockers?.grouping || {};
  return {
    enabled: cfg.enabled === true,
    separator: String(cfg.separator || " - "),
    trimParts: cfg.trimParts !== false
  };
}

function logicalPlayerIdFromName(name) {
  return `player:${String(name || "player").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "player"}`;
}

function splitGroupedShockerName(name) {
  const grouping = getShockerGroupingConfig();
  const raw = String(name || "");
  if (!grouping.enabled || !grouping.separator || !raw.includes(grouping.separator)) {
    return { grouped: false, groupName: raw, memberName: raw };
  }
  const idx = raw.indexOf(grouping.separator);
  let groupName = raw.slice(0, idx);
  let memberName = raw.slice(idx + grouping.separator.length);
  if (grouping.trimParts) {
    groupName = groupName.trim();
    memberName = memberName.trim();
  }
  if (!groupName || !memberName) return { grouped: false, groupName: raw, memberName: raw };
  return { grouped: true, groupName, memberName };
}

function buildLogicalPlayers() {
  const grouping = getShockerGroupingConfig();
  if (!grouping.enabled) {
    return (shockers || []).map(s => ({
      id: s.id,
      name: s.name,
      isGrouped: false,
      devices: [{ id: s.id, name: s.name, memberName: s.name }]
    }));
  }

  const players = new Map();
  (shockers || []).forEach(s => {
    if (!s?.id) return;
    const parsed = splitGroupedShockerName(s.name);
    const id = parsed.grouped ? logicalPlayerIdFromName(parsed.groupName) : s.id;
    const name = parsed.grouped ? parsed.groupName : s.name;
    if (!players.has(id)) players.set(id, { id, name, isGrouped: parsed.grouped, devices: [] });
    const player = players.get(id);
    player.devices.push({ id: s.id, name: s.name, memberName: parsed.grouped ? parsed.memberName : s.name });
    if (player.devices.length > 1) player.isGrouped = true;
  });
  return Array.from(players.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function getLogicalPlayerById(id) {
  return buildLogicalPlayers().find(p => String(p.id) === String(id)) || null;
}

function getValidLogicalPlayerIds() {
  return new Set(buildLogicalPlayers().map(p => String(p.id)));
}

function expandTargetDevices(target) {
  if (!target) return [];
  if (Array.isArray(target.devices)) return target.devices.map(d => ({ ...d, parentPlayer: target }));
  return [{ id: target.id, name: target.name, memberName: target.name, parentPlayer: target }];
}

function activeShockers() {
  return buildLogicalPlayers().filter(p => !eliminated.has(p.id));
}

function ensureAllPlayerStats() {
  buildLogicalPlayers().forEach(s => ensurePlayerStats(s));
}

function getShockerById(id) {
  return getLogicalPlayerById(id) || shockers.find(s => String(s.id) === String(id)) || null;
}

function getShockerName(id, fallback = "Unknown player") {
  return getShockerById(id)?.name || fallback;
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
  const parts = [];
  (targets || []).filter(Boolean).forEach(player => {
    const devices = expandTargetDevices(player);
    if (devices.length <= 1) {
      const id = devices[0]?.id || player.id;
      const applied = appliedById?.[id] ?? appliedById?.[player.id] ?? applyPlayerMultiplier(rolledValue, id);
      parts.push(`${player.name}: ${applied} (${getPlayerMultiplier(id)}%)`);
    } else {
      const deviceText = devices.map(d => `${d.memberName || d.name}: ${appliedById?.[d.id] ?? applyPlayerMultiplier(rolledValue, d.id)} (${getPlayerMultiplier(d.id)}%)`).join(" / ");
      parts.push(`${player.name} [${deviceText}]`);
    }
  });
  return `Rolled ${rolledValue} · Applied ${parts.join(", ")}`;
}

function buildTargetSegments() {
  const playerWeight = Number(document.getElementById("playerWeight").value || 100);
  const players = activeShockers();
  const segments = players.map((s, idx) => ({ type:"player", label:s.name, shocker:s, weight:playerWeight, colorIndex:idx }));
  const safeWeight = Number(document.getElementById("safeWeight").value || 0);
  const shockAllWeight = Number(document.getElementById("shockAllWeight").value || 0);

  if (safeWeight > 0) segments.push({ type:"safe", label:"SAFE", weight:safeWeight });
  if (shockAllWeight > 0 && players.length > 1) segments.push({ type:"all", label:"ALL", weight:shockAllWeight });

  return segments;
}

function renderPlayers() {
  playersDiv.innerHTML = "";
  const grouping = getShockerGroupingConfig();
  const players = buildLogicalPlayers();

  if (grouping.enabled) {
    const note = document.createElement("div");
    note.className = "muted";
    note.textContent = `Grouping enabled · Separator: ${grouping.separator} · ${players.length} player/group(s), ${shockers.length} device(s)`;
    playersDiv.appendChild(note);
  }

  players.forEach(s => {
    const row = document.createElement("div");
    row.className = eliminated.has(s.id) ? "player eliminated" : "player";

    const info = document.createElement("div");

    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "playerNameButton";
    nameButton.textContent = s.name;
    nameButton.title = "Click to show/hide player ID";
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

    if (s.devices?.length > 1 || s.isGrouped) {
      const deviceLine = document.createElement("div");
      deviceLine.className = "playerStats groupedDeviceLine";
      deviceLine.innerHTML = s.devices.map(d => `${escapeHtml(d.memberName || d.name)} <strong>${getPlayerMultiplier(d.id)}%</strong>`).join(" · ");
      info.appendChild(deviceLine);
    }

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

function formatTargetResultText(targetPicked, targets) {
  if (targetPicked?.type === "virtual") {
    return targetPicked.resultText || `${targetPicked.virtualName || targetPicked.name || targetPicked.label || "Virtual target"} selected`;
  }
  const actualNames = (targets || []).filter(Boolean).map(s => s.name).join(" + ");
  if (targetPicked?.bodyguardRedirect) {
    const originalName = targetPicked.originalShocker?.name || targetPicked.label || "Original target";
    const bodyguardName = targetPicked.bodyguardShocker?.name || actualNames || "Bodyguard";
    if (targetPicked.type === "all") return `SHOCK ALL selected · ${originalName} protected by ${bodyguardName}; actual targets: ${actualNames}`;
    return `${originalName} selected → ${bodyguardName} takes the hit`;
  }
  if (targetPicked?.type === "all") return "SHOCK ALL selected";
  if ((targets || []).length > 1) return `${actualNames} selected`;
  return `${actualNames || targetPicked?.label || "Target"} selected`;
}

async function activateTargets(targets, value, roundState = null) {
  const appliedById = {};
  const deviceQueue = [];
  (targets || []).filter(Boolean).forEach(player => {
    expandTargetDevices(player).forEach(device => {
      deviceQueue.push({ player, device });
    });
  });

  for (const item of deviceQueue) {
    const appliedValue = applyPlayerMultiplier(value, item.device.id);
    appliedById[item.device.id] = appliedValue;
    appliedById[item.player.id] = Math.max(Number(appliedById[item.player.id] || 0), appliedValue);
    await sendControl({ id: item.device.id, name: item.device.name }, appliedValue);
  }

  const doubleChance = roundState?.doubleHitChanceOverride !== null && roundState?.doubleHitChanceOverride !== undefined
    ? Math.max(0, Math.min(100, Number(roundState.doubleHitChanceOverride)))
    : getPercent("doubleHitChance");
  if (value > 0 && rollPercent(doubleChance)) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Hidden double-hit triggered. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const item of deviceQueue) await sendControl({ id: item.device.id, name: item.device.name }, appliedById[item.device.id] ?? applyPlayerMultiplier(value, item.device.id));
  }

  const forcedDoubleIds = roundState?.forcedDoubleShockTargetIds || new Set();
  const forcedTargets = (targets || []).filter(s => forcedDoubleIds.has(String(s.id)));
  if (value > 0 && forcedTargets.length) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Forced double-shock token triggered for ${forcedTargets.map(s => s.name).join(", ")}. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const player of forcedTargets) {
      for (const device of expandTargetDevices(player)) await sendControl({ id: device.id, name: device.name }, appliedById[device.id] ?? applyPlayerMultiplier(value, device.id));
      const mod = (roundState.pendingRoundModifiers || []).find(m => m.type === "forcedDoubleShockNextRound" && String(m.targetPlayerId) === String(player.id));
      if (mod) markRoundModifierConsumed(roundState, mod, "forced double shock applied");
    }
  }
  return appliedById;
}

const baseLoadShockersForGrouping = loadShockers;
loadShockers = async function loadShockersWithGrouping(options = {}) {
  await baseLoadShockersForGrouping(options);
  const valid = getValidLogicalPlayerIds();
  eliminated = new Set(Array.from(eliminated).filter(id => valid.has(String(id))));
  const physicalIds = new Set((shockers || []).map(s => String(s.id)));
  Object.keys(playerMultipliers || {}).forEach(id => {
    if (!physicalIds.has(String(id)) && !String(id).startsWith("player:")) delete playerMultipliers[id];
  });
  (shockers || []).forEach(s => { if (playerMultipliers[s.id] === undefined) playerMultipliers[s.id] = 100; });
  const players = buildLogicalPlayers();
  const sourcePill = document.getElementById("sourcePill");
  if (sourcePill && getShockerGroupingConfig().enabled) sourcePill.textContent += ` · ${players.length} groups`;
  renderPlayers();
  redrawAllWheels();
};
