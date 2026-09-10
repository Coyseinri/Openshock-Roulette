"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sentIntiface = [];
const sentOpenShock = [];
let failOpenShock = false;
let delayOpenShockActivation = false;
let releaseOpenShockActivation = null;
let failIntifaceStopAll = false;
let gameIntegrationEnabled = true;

const rawToy = {
  DeviceIndex: 7,
  DeviceName: "Motorbunny Buck",
  DeviceDisplayName: "Buck",
  DeviceMessages: {
    ScalarCmd: [
      { Index: 0, ActuatorType: "Vibrate" },
      { Index: 1, ActuatorType: "Rotate" }
    ]
  }
};

function extractFeatures(device) {
  return device.DeviceMessages.ScalarCmd.map((feature, index) => ({
    command: "ScalarCmd",
    featureIndex: Number(feature.Index ?? index),
    actuatorType: String(feature.ActuatorType || "Scalar"),
    descriptor: ""
  }));
}
function stableFeatureKey(feature) {
  return [feature.command, feature.featureIndex, feature.actuatorType, feature.descriptor || ""].map(v => String(v).toLowerCase()).join(":");
}
function deviceKey(device) {
  const features = extractFeatures(device).map(stableFeatureKey).join("|");
  return [String(device.DeviceDisplayName || "").toLowerCase(), String(device.DeviceName || "").toLowerCase(), features].join("||");
}
const toyKey = deviceKey(rawToy);

const player = {
  id: "osr-player:test",
  name: "Test Player",
  devices: [
    { provider: "openshock", id: "shock-1", name: "Collar", enabled: true, intensityMultiplier: 75 },
    { provider: "intiface", id: toyKey, name: "Buck", enabled: true, intensityMultiplier: 30, preferredTemplate: "all-steady" }
  ]
};

const context = {
  console,
  setTimeout,
  clearTimeout,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Map,
  Set,
  Object,
  JSON,
  Date,
  Promise,
  fs,
  path,
  APP_ROOT: path.resolve(__dirname, ".."),
  CONFIG: { intiface: { enabled: true } },
  clampInt(value, min, max) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)));
  },
  clampPercent(value, fallback = 100) {
    const n = Number(value);
    return Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : fallback)));
  },
  readConfig() {
    return {
      intiface: {
        enabled: true,
        gameIntegrationEnabled,
        game: { activationDurationMultiplier: 1, vibeDurationMultiplier: 1, minDurationMs: 100, maxDurationMs: 100 }
      }
    };
  },
  safety() {
    return { serverMaxShockIntensity: 99, serverMaxVibrateIntensity: 100, minDurationMs: 100, maxDurationMs: 1000, defaultDurationMs: 100 };
  },
  readSessionState() {
    return {
      intiface: {
        mappings: {
          "7": {
            cacheKey: toyKey,
            features: {
              "7:ScalarCmd:0:Vibrate": "main",
              "7:ScalarCmd:1:Rotate": "secondary"
            }
          }
        }
      }
    };
  },
  readPlayerSetupIntifaceCache() {
    return {
      profiles: {
        [toyKey]: {
          featureRoles: {
            [stableFeatureKey(extractFeatures(rawToy)[0])]: "main",
            [stableFeatureKey(extractFeatures(rawToy)[1])]: "secondary"
          }
        }
      }
    };
  },
  intifaceDeviceFeaturesForSetup: extractFeatures,
  stableIntifaceFeatureKey: stableFeatureKey,
  stableIntifaceDeviceKey: deviceKey,
  resolveConfiguredPlayer: async id => String(id) === player.id || String(id) === "shock-1" ? player : null,
  debugState: { counters: { shockCommands: 0, stopCommands: 0 } },
  requestOpenShock: async (_method, _route, body, meta) => {
    sentOpenShock.push({ body, meta });
    if (delayOpenShockActivation && ["shock", "vibrate"].includes(meta?.action)) {
      await new Promise(resolve => { releaseOpenShockActivation = resolve; });
    }
    if (failOpenShock) throw new Error("OpenShock offline");
    return { statusCode: 200, body: { ok: true } };
  },
  intifaceService: {
    snapshot: () => ({ ready: true, devices: [rawToy] }),
    sendRaw: async messages => {
      sentIntiface.push(messages);
      if (failIntifaceStopAll && messages?.StopAllDevices) throw new Error("Intiface stop failed");
      return { Ok: { Id: 1 } };
    }
  },
  sendJson() {},
  readBody: async () => ({}),
  getConfiguredPlayers: async () => [player]
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "server", "modules", "game-activation.js"), "utf8"), context);

(async () => {
  sentOpenShock.length = 0;
  sentIntiface.length = 0;
  failOpenShock = false;
  gameIntegrationEnabled = true;

  const normal = await context.activateGamePlayer({ playerId: player.id, rolledValue: 80, mode: "normal", shockDurationMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(normal.providers.openshock.devices[0].intensity, 60);
  const scalarNormal = sentIntiface.find(item => item?.ScalarCmd)?.ScalarCmd || sentIntiface.flat().find(item => item?.ScalarCmd)?.ScalarCmd;
  assert.ok(scalarNormal, "Expected ScalarCmd for mixed-output toy");
  assert.equal(scalarNormal.Scalars.length, 2);
  for (const item of scalarNormal.Scalars) assert.ok(Math.abs(item.Scalar - 0.24) < 1e-9);

  await context.stopAllGameOutputs(["shock-1"]);
  sentOpenShock.length = 0;
  sentIntiface.length = 0;

  // Replacing an active run (double-hit style) must not let the cancelled run stop the replacement.
  await context.activateGamePlayer({ playerId: player.id, rolledValue: 50, mode: "normal", shockDurationMs: 100 });
  await context.activateGamePlayer({ playerId: player.id, rolledValue: 60, mode: "normal", shockDurationMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 20));
  const earlyStops = sentIntiface.filter(item => item?.StopDeviceCmd || (Array.isArray(item) && item.some(msg => msg.StopDeviceCmd)));
  assert.equal(earlyStops.length, 0, "Cancelled toy run must not stop a replacement run");
  await context.stopAllGameOutputs(["shock-1"]);
  sentOpenShock.length = 0;
  sentIntiface.length = 0;

  const vibe = await context.activateGamePlayer({ playerId: player.id, rolledValue: 0, mode: "vibe", shockDurationMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(vibe.providers.openshock.devices[0].type, "Vibrate");
  assert.equal(vibe.providers.openshock.devices[0].intensity, 75);
  const scalarVibe = sentIntiface.find(item => item?.ScalarCmd)?.ScalarCmd || sentIntiface.flat().find(item => item?.ScalarCmd)?.ScalarCmd;
  assert.ok(scalarVibe, "Expected Vibe to activate the full toy template");
  assert.equal(scalarVibe.Scalars.length, 2);
  for (const item of scalarVibe.Scalars) assert.ok(Math.abs(item.Scalar - 0.30) < 1e-9);

  await context.stopAllGameOutputs(["shock-1"]);
  sentOpenShock.length = 0;
  sentIntiface.length = 0;
  failOpenShock = true;
  const partial = await context.activateGamePlayer({ playerId: player.id, rolledValue: 50, mode: "normal", shockDurationMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(partial.providers.openshock.ok, false);
  assert.ok(sentIntiface.some(item => item?.ScalarCmd || (Array.isArray(item) && item.some(msg => msg.ScalarCmd))), "Toy should still activate when OpenShock fails");


  await context.stopAllGameOutputs(["shock-1"]);
  sentOpenShock.length = 0;
  sentIntiface.length = 0;

  // A 0% device multiplier must remain a real zero and send no toy activation.
  player.devices[1].intensityMultiplier = 0;
  const zeroToy = await context.activateGamePlayer({ playerId: player.id, rolledValue: 80, mode: "normal", shockDurationMs: 100 });
  assert.equal(zeroToy.providers.intiface[0].skipped, true);
  assert.equal(zeroToy.providers.intiface[0].maxPowerPercent, 0);
  assert.equal(sentIntiface.some(item => item?.ScalarCmd || (Array.isArray(item) && item.some(msg => msg.ScalarCmd))), false);
  player.devices[1].intensityMultiplier = 30;

  // Duration scaling must respect configured min/max bounds.
  assert.equal(context.gameToyDurationMs(1, "normal", player.devices[1]), 100);
  assert.equal(context.gameToyDurationMs(100000, "vibe", player.devices[1]), 100);

  // Per-player Stop is a first-class unified outcome and stops both providers.
  sentOpenShock.length = 0;
  sentIntiface.length = 0;
  failOpenShock = false;
  const stoppedPlayer = await context.activateGamePlayer({ playerId: player.id, mode: "stop" });
  assert.equal(stoppedPlayer.mode, "stop");
  assert.equal(stoppedPlayer.providers.openshock.ok, true);
  assert.ok(sentOpenShock.some(item => item.body?.shocks?.every(shock => shock.type === "Stop")));
  assert.ok(sentIntiface.some(item => item?.StopDeviceCmd), "Per-player stop must stop the mapped toy");

  gameIntegrationEnabled = false;
  sentIntiface.length = 0;
  const disabled = await context.activateGamePlayer({ playerId: player.id, rolledValue: 50, mode: "normal", shockDurationMs: 100 });
  assert.equal(disabled.providers.intiface[0].skipped, true);
  assert.match(disabled.providers.intiface[0].reason, /disabled/i);

  gameIntegrationEnabled = true;
  failOpenShock = true;
  sentIntiface.length = 0;
  const stopped = await context.stopAllGameOutputs(["shock-1"]);
  assert.equal(stopped.openshock.ok, false);
  assert.equal(stopped.intiface.ok, true);
  assert.ok(sentIntiface.some(item => item?.StopAllDevices), "Intiface Stop All must run even if OpenShock stop fails");

  // A Stop All invalidates an in-flight activation before it can start a Toy run.
  failOpenShock = false;
  delayOpenShockActivation = true;
  sentIntiface.length = 0;
  const token = context.beginOutputRun();
  const pending = context.activateGamePlayer({ playerId: player.id, rolledValue: 70, mode: "normal", shockDurationMs: 100, outputRunToken: token });
  while (!releaseOpenShockActivation) await new Promise(resolve => setTimeout(resolve, 1));
  await context.stopAllGameOutputs(["shock-1"]);
  releaseOpenShockActivation();
  await assert.rejects(pending, /cancelled by Stop All/);
  assert.equal(sentIntiface.some(item => item?.ScalarCmd || (Array.isArray(item) && item.some(msg => msg.ScalarCmd))), false, "A cancelled in-flight Shock request must not start Toys");
  delayOpenShockActivation = false;
  releaseOpenShockActivation = null;

  // Stop failures must be reported instead of being presented as success.
  failIntifaceStopAll = true;
  const failedToyStop = await context.stopAllGameOutputs([]);
  assert.equal(failedToyStop.intiface.ok, false);
  assert.match(failedToyStop.intiface.error, /Intiface stop failed/);
  assert.equal(failedToyStop.ok, false);
  failIntifaceStopAll = false;

  console.log("Game activation regression test passed.");
})().catch(err => { console.error(err); process.exitCode = 1; });
