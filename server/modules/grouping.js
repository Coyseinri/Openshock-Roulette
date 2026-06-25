// Prefix-based logical player grouping helpers.
// Physical OpenShock devices stay untouched; logical players are derived from names.

function shockerGroupingConfig() {
  const cfg = readConfig()?.shockers?.grouping || {};
  return {
    enabled: cfg.enabled === true,
    separator: String(cfg.separator || " - "),
    trimParts: cfg.trimParts !== false,
    fallbackUngrouped: cfg.fallbackUngrouped !== false
  };
}

function splitGroupedShockerName(name, grouping = shockerGroupingConfig()) {
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

function logicalPlayerIdFromName(name) {
  return `player:${String(name || "player").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "player"}`;
}

function buildLogicalPlayersFromShockers(shockers = []) {
  const grouping = shockerGroupingConfig();
  if (!grouping.enabled) {
    return (shockers || []).map(s => ({
      id: s.id,
      name: s.name,
      isGrouped: false,
      devices: [{ id: s.id, name: s.name, memberName: s.name }]
    }));
  }

  const byId = new Map();
  for (const s of shockers || []) {
    if (!s?.id) continue;
    const parsed = splitGroupedShockerName(s.name, grouping);
    const playerId = parsed.grouped ? logicalPlayerIdFromName(parsed.groupName) : s.id;
    const playerName = parsed.grouped ? parsed.groupName : s.name;
    if (!byId.has(playerId)) {
      byId.set(playerId, {
        id: playerId,
        name: playerName,
        isGrouped: parsed.grouped,
        devices: []
      });
    }
    const player = byId.get(playerId);
    player.devices.push({ id: s.id, name: s.name, memberName: parsed.grouped ? parsed.memberName : s.name });
    if (player.devices.length > 1) player.isGrouped = true;
  }
  return Array.from(byId.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function findLogicalPlayerById(players = [], id) {
  return (players || []).find(p => String(p.id) === String(id)) || null;
}

async function getLogicalPlayers(existingShockers = null) {
  const shockers = existingShockers || (await getShockers()).shockers;
  return buildLogicalPlayersFromShockers(shockers);
}

async function resolveLogicalControlDevices(id) {
  const { shockers } = await getShockers();
  const players = buildLogicalPlayersFromShockers(shockers);
  const player = findLogicalPlayerById(players, id);
  if (player) return player.devices.map(d => ({ ...d, playerId: player.id, playerName: player.name }));
  const direct = shockers.find(s => String(s.id) === String(id));
  return direct ? [{ id: direct.id, name: direct.name, memberName: direct.name, playerId: direct.id, playerName: direct.name }] : [];
}
