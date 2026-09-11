'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDevicePresence } = require('../server/device-presence');

test('generations reject old work after reconnect; unaffected devices remain usable', () => {
  let now = 1000;
  const cancelled = [];
  const registry = createDevicePresence({ now: () => now, onInvalidate: (...args) => cancelled.push(args) });
  registry.update('intiface', 'a', 'online', '', 7);
  registry.update('intiface', 'b', 'online', '', 8);
  const captured = registry.snapshot();
  registry.update('intiface', 'a', 'online', '', 7);
  assert.equal(registry.allowed('intiface', 'a', captured), true);
  registry.update('intiface', 'a', 'offline', 'Removed');
  now += 100;
  registry.update('intiface', 'a', 'online', '', 7);
  assert.equal(registry.allowed('intiface', 'a', captured), false);
  assert.equal(registry.allowed('intiface', 'b', captured), true);
  assert.equal(registry.allowed('intiface', 'a', registry.snapshot()), true);
  assert.equal(cancelled.length, 2);
  assert.equal(registry.transitions.length, 1, 'fast transitions collapse to one notification');
});

function runtime() {
  const raw = { DeviceIndex: 7, OSRGeneration: 1, DeviceName: 'Toy A', DeviceMessages: {} };
  const shock = { provider: 'openshock', id: 'shock', name: 'Collar', enabled: true, intensityMultiplier: 50 };
  const toy = { provider: 'intiface', id: 'Toy A', name: 'Toy A', enabled: true, intensityMultiplier: 40, preferredTemplate: 'all-steady' };
  const player = { id: 'p1', name: 'Player', enabled: true, devices: [shock, toy] };
  const sent = [];
  let devices = [raw];
  const cache = { profiles: { 'Toy A': { featureRoles: { motor: 'main' } } } };
  const ctx = {
    console, setTimeout, clearTimeout, fs, path, require: name => name === './device-presence' ? { createDevicePresence } : require(name),
    APP_ROOT: path.resolve(__dirname, '..'), readPlayerSetup: () => ({ players: [player] }),
    readPlayerSetupIntifaceCache: () => cache, readSessionState: () => ({}),
    stableIntifaceDeviceKey: d => d.DeviceName, stableIntifaceFeatureKey: () => 'motor',
    intifaceDeviceFeaturesForSetup: () => [{ command: 'ScalarCmd', featureIndex: 0, actuatorType: 'Vibrate' }],
    clampPercent: n => Math.max(0, Math.min(100, Number(n ?? 100))), clampInt: (n, min, max) => Math.max(min, Math.min(max, Math.round(Number(n)))),
    readConfig: () => ({ intiface: { enabled: true, gameIntegrationEnabled: true, game: { minDurationMs: 100, maxDurationMs: 100 } } }),
    safety: () => ({ defaultDurationMs: 100, minDurationMs: 100, maxDurationMs: 1000, serverMaxShockIntensity: 99, serverMaxVibrateIntensity: 100 }),
    intifaceService: { snapshot: () => ({ ready: true, state: 'ready', devices }), sendRaw: async messages => { sent.push(messages); } },
    getConfiguredPlayers: async () => [player], resolveConfiguredPlayer: async () => player,
    debugState: { counters: { shockCommands: 0, stopCommands: 0 } },
    requestOpenShock: async (_method, _url, body) => { sent.push(body); return { statusCode: 200 }; }
  };
  vm.createContext(ctx);
  for (const file of ['game-activation.js','device-presence.js','event-device-effects.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../server/modules', file), 'utf8'), ctx);
  ctx.observeOpenShockPresence(true, [{ id: 'shock' }]);
  return { ctx, player, raw, toy, shock, sent, cache, setDevices: next => { devices = next; ctx.syncDevicePresence(); } };
}

test('hardware refresh is read-only; unmapped and ambiguous Toys block, offline and zero output warn', () => {
  const r = runtime();
  assert.equal(r.ctx.hardwarePreflight([r.player]).status, 'ready');
  r.setDevices([]);
  assert.equal(r.ctx.hardwarePreflight([r.player]).status, 'warnings');
  r.setDevices([r.raw, { ...r.raw, DeviceIndex: 8 }]);
  assert.equal(r.ctx.hardwarePreflight([r.player]).status, 'blocked');
  r.setDevices([r.raw]);
  r.cache.profiles['Toy A'].featureRoles = {};
  assert.equal(r.ctx.hardwarePreflight([r.player]).status, 'blocked');
  r.cache.profiles['Toy A'].featureRoles = { motor: 'main' };
  r.toy.intensityMultiplier = 0;
  assert.equal(r.ctx.hardwarePreflight([r.player]).status, 'warnings');
  assert.equal(r.sent.length, 0, 'status checks must never activate or stop hardware');
});

test('API failures become unknown; recovery and an empty device list cannot replay old work', () => {
  const { ctx, shock } = runtime();
  const token = ctx.beginOutputRun();
  ctx.observeOpenShockPresence(false);
  assert.equal(ctx.presence.entries.get('openshock:shock').status, 'unknown');
  ctx.observeOpenShockPresence(true, [{ id: 'shock' }]);
  assert.equal(ctx.presenceDeviceAllowed(shock, token), false);
  assert.equal(ctx.presenceDeviceAllowed(shock, ctx.beginOutputRun()), true);
  ctx.observeOpenShockPresence(true, []);
  assert.equal(ctx.presenceDeviceAllowed(shock), false);
});

test('reconnect during a mixed activation cancels only the affected Toy', async () => {
  const r = runtime();
  let release;
  r.ctx.requestOpenShock = async () => { await new Promise(resolve => { release = resolve; }); return { statusCode: 200 }; };
  const run = r.ctx.activateGamePlayer({ playerId: 'p1', rolledValue: 30 });
  await new Promise(resolve => setImmediate(resolve));
  r.setDevices([]); r.setDevices([{ ...r.raw, OSRGeneration: 2 }]);
  release();
  const result = await run;
  assert.equal(result.providers.openshock.ok, true);
  assert.equal(result.providers.intiface[0].skipped, true);
  assert.equal(r.sent.length, 0);
});

test('active template never sends another step or stop to a reused index', async () => {
  const r = runtime();
  const result = r.ctx.startGameToyRun(r.toy, { rolledValue: 30, mode: 'normal', shockDurationMs: 100 });
  assert.equal(result.started, true);
  assert.equal(r.sent.length, 1);
  r.setDevices([]); r.setDevices([{ ...r.raw, DeviceName: 'Different Toy' }]);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(r.sent.length, 1, 'old template must not stop or activate the replacement');
});

test('Stop All invalidates queued runs and in-flight setup lookups', async () => {
  const r = runtime();
  const token = r.ctx.beginOutputRun();
  let release;
  r.ctx.getConfiguredPlayers = async () => new Promise(resolve => { release = resolve; });
  const test = r.ctx.testSetupDevice({ provider: 'intiface', deviceId: 'Toy A' });
  r.ctx.cancelPendingOutputRuns();
  release([r.player]);
  await assert.rejects(test, /cancelled/);
  assert.throws(() => r.ctx.assertOutputRunActive(token), /cancelled/);
  assert.equal(r.sent.length, 0);
});

test('manual hardware tests reject a generation that changed after rendering', async () => {
  const r = runtime();
  const expectedGeneration = r.ctx.hardwarePreflight([r.player]).devices.find(d => d.provider === 'intiface').generation;
  r.setDevices([]); r.setDevices([{ ...r.raw, OSRGeneration: 2 }]);
  await assert.rejects(r.ctx.testSetupDevice({ provider: 'intiface', deviceId: 'Toy A', expectedGeneration }), /changed/);
  assert.equal(r.sent.length, 0);
});

test('Intiface device lists preserve healthy generations; remove/add and index reuse invalidate them', () => {
  const r = runtime();
  r.ctx.setTimeout = () => 0; // Do not start the real service in this test.
  r.ctx.WebSocket = class { static OPEN = 1; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server/modules/intiface-service.js'), 'utf8'), r.ctx);
  const service = r.ctx.intifaceService;
  service.ws = { readyState: 1 }; service.state = 'ready';
  service.replaceDevices([r.raw]); r.ctx.syncDevicePresence();
  const first = service.devices.get(7).OSRGeneration;
  const token = r.ctx.beginOutputRun();
  service.replaceDevices([r.raw]); r.ctx.syncDevicePresence();
  assert.equal(service.devices.get(7).OSRGeneration, first);
  assert.equal(r.ctx.presenceDeviceAllowed(r.toy, token), true);
  service.handleMessage({ data: JSON.stringify([{ DeviceRemoved: { DeviceIndex: 7 } }]) });
  service.handleMessage({ data: JSON.stringify([{ DeviceAdded: r.raw }]) });
  assert.notEqual(service.devices.get(7).OSRGeneration, first);
  assert.equal(r.ctx.presenceDeviceAllowed(r.toy, token), false);
  const second = service.devices.get(7).OSRGeneration;
  service.replaceDevices([{ ...r.raw, DeviceName: 'Different Toy' }]);
  assert.notEqual(service.devices.get(7).OSRGeneration, second);
  const beforeStop = service.devices.get(7).OSRGeneration;
  r.ctx.cancelPendingOutputRuns();
  assert.notEqual(service.devices.get(7).OSRGeneration, beforeStop, 'Stop All also invalidates delayed browser preview packets');
});
