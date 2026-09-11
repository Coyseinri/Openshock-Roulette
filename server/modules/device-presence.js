var presence = require('./device-presence').createDevicePresence({
  onInvalidate(provider, id) {
    if (provider === 'intiface' && typeof cancelGameToyRun === 'function') cancelGameToyRun(id);
  }
});
var presenceOpenShock = { reachable: null, ids: new Set(), failures: 0 };
var presenceRunTokens = new Map();

function syncDevicePresence() {
  const setup = readPlayerSetup();
  const runtime = typeof intifaceService !== 'undefined' ? intifaceService.snapshot() : { ready: false, state: 'disabled', devices: [] };
  const cache = readPlayerSetupIntifaceCache();
  const toys = new Map();
  for (const raw of runtime.devices || []) {
    const id = stableIntifaceDeviceKey(raw);
    toys.set(id, [...(toys.get(id) || []), raw]);
  }
  const assigned = new Set();
  const counts = new Map();
  for (const player of setup?.players || []) for (const device of player.devices || []) { const key = presence.key(device.provider, device.id); counts.set(key, (counts.get(key) || 0) + 1); }
  for (const player of setup?.players || []) for (const device of player.devices || []) {
    assigned.add(presence.key(device.provider, device.id));
    let status = 'online', reason = '', transport = null;
    if (counts.get(presence.key(device.provider, device.id)) > 1) { status = 'blocked'; reason = 'Device is assigned to multiple players'; }
    else if (player.enabled === false || device.enabled === false) { status = 'blocked'; reason = 'Disabled in Player Setup'; }
    else if (device.provider === 'openshock') {
      transport = JSON.stringify([player.id, device.intensityMultiplier]);
      if (presenceOpenShock.reachable !== true) { status = 'unknown'; reason = 'OpenShock API availability is unconfirmed'; }
      else if (!presenceOpenShock.ids.has(device.id)) { status = 'offline'; reason = 'Device is absent from the latest OpenShock device list'; }
      else reason = 'API reachable; physical response must be tested';
    } else {
      const matches = toys.get(device.id) || [];
      const roles = cache.profiles?.[device.id]?.featureRoles || {};
      if (matches.length > 1) { status = 'blocked'; reason = 'Ambiguous Toy identity: give identical Toys unique display names'; }
      else if (!Object.values(roles).some(role => role && role !== 'ignore')) { status = 'blocked'; reason = 'Toy output is unmapped'; }
      else if (!runtime.ready) { status = runtime.state === 'reconnecting' || runtime.state === 'connecting' ? 'reconnecting' : 'offline'; reason = 'Intiface is not connected'; }
      else if (!matches.length) { status = 'offline'; reason = 'Toy is disconnected'; }
      else {
        const raw = matches[0];
        const template = readGameIntifaceTemplates().find(item => item.id === (device.preferredTemplate || 'soft-wave'));
        const features = intifaceDeviceFeaturesForSetup(raw).filter(feature => {
          const role = String(roles[stableIntifaceFeatureKey(feature)] || 'ignore').toLowerCase();
          return role !== 'ignore' && (!template?.roles?.length || template.roles.includes(role));
        });
        transport = JSON.stringify([raw.DeviceIndex, raw.OSRGeneration, player.id, roles, device.preferredTemplate, device.intensityMultiplier, device.durationMultiplierOverride]);
        if (!template || features.length < gameTemplateMinimumOutputs(template)) { status = 'blocked'; reason = 'Template has no compatible mapped outputs'; }
      }
    }
    presence.update(device.provider, device.id, status, reason, transport);
  }
  for (const entry of presence.entries.values()) if (!assigned.has(presence.key(entry.provider, entry.id))) presence.update(entry.provider, entry.id, 'blocked', 'Device is no longer assigned');
  return presence;
}

function observeOpenShockPresence(ok, shockers = null) {
  presenceOpenShock.reachable = Boolean(ok);
  presenceOpenShock.failures = ok ? 0 : Math.min(6, presenceOpenShock.failures + 1);
  if (Array.isArray(shockers)) presenceOpenShock.ids = new Set(shockers.map(device => String(device.id)));
  if (!ok) presence.invalidateProvider('openshock', 'unknown', 'OpenShock API request failed; physical device state is unknown');
  syncDevicePresence();
}

function capturePresenceRun(generation) {
  syncDevicePresence();
  const token = require('node:crypto').randomUUID();
  presenceRunTokens.set(token, { generation, devices: presence.snapshot(), createdAt: Date.now() });
  for (const [id, item] of presenceRunTokens) if (Date.now() - item.createdAt > 60 * 60 * 1000) presenceRunTokens.delete(id);
  while (presenceRunTokens.size > 200) presenceRunTokens.delete(presenceRunTokens.keys().next().value);
  return token;
}

function presenceDeviceAllowed(device, token = null) {
  const captured = token == null ? null : presenceRunTokens.get(token)?.devices;
  if (token != null && !captured) return false;
  return presence.allowed(device.provider, device.id, captured);
}

function hardwarePreflight(players) {
  syncDevicePresence();
  const blockers = [], warnings = [], devices = [];
  const active = (players || []).filter(player => player.enabled !== false);
  if (!active.length) blockers.push('Add and enable at least one player.');
  for (const player of active) {
    if (!player.devices.some(device => device.enabled !== false)) warnings.push(`${player.name}: no enabled output devices.`);
    for (const device of player.devices) {
      const entry = presence.entries.get(presence.key(device.provider, device.id));
      const enabled = device.enabled !== false;
      if (enabled && entry?.status === 'blocked') blockers.push(`${player.name} / ${device.name}: ${entry.reason}`);
      else if (enabled && entry?.status !== 'online') warnings.push(`${player.name} / ${device.name}: ${entry?.reason || 'Unknown availability'}`);
      if (enabled && device.provider === 'intiface' && !gameIntifaceConfig().gameIntegrationEnabled) warnings.push(`${player.name} / ${device.name}: Toy gameplay integration is disabled.`);
      if (enabled && clampPercent(device.intensityMultiplier) === 0) warnings.push(`${player.name} / ${device.name}: power multiplier is 0%.`);
      devices.push({ playerId: player.id, playerName: player.name, id: device.id, provider: device.provider, name: device.name,
        enabled, status: entry?.status || 'unknown', reason: entry?.reason || '', generation: entry?.generation,
        canTest: enabled && entry?.status === 'online', canStop: device.provider === 'openshock' || entry?.status === 'online',
        multiplier: clampPercent(device.intensityMultiplier), durationMs: device.provider === 'intiface' ? gameToyDurationMs(safety().defaultDurationMs, 'normal', device) : safety().defaultDurationMs });
    }
  }
  return { status: blockers.length ? 'blocked' : warnings.length ? 'warnings' : 'ready', blockers, warnings, devices,
    checkedAt: new Date().toISOString(), physicalResponseVerified: false,
    note: 'Availability checks do not prove physical output. Run individual tests and confirm the correct device responds.' };
}
