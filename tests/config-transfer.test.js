"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "osr-config-transfer-"));
let setup = {
  initialized: true,
  players: [{ id: "player:a", name: "Alice", enabled: true, createdAt: "2026-01-01T00:00:00Z", devices: [
    { provider: "openshock", id: "shock-stable", name: "Collar", memberName: "Alice", enabled: true, intensityMultiplier: 80 }
  ] }]
};
let cache = { profiles: { "toy-stable": { deviceName: "Toy", playerId: "player:a", featureRoles: { vibrate: 0 }, profile: { intensityMultiplier: 60, preferredTemplate: "soft-wave" }, DeviceIndex: 9 } } };
let disk = {
  version: "1.4.0", server: { apiHost: "api.openshock.app" }, api: { openshock: { token: "never-export" } },
  safety: { absoluteMaxIntensity: 80 }, keyboard: {}, spinners: {}, game: {}, events: {}, pages: {}, economy: {}, ui: {},
  devices: { shockers: {} }, intiface: { websocketUrl: "ws://127.0.0.1:12345", cacheFile: "/tmp/cache.json", commandTimeoutMs: 3000 }
};
fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify(disk));
let failCacheWrite = false;
const context = {
  require, fs, path, Buffer, console, APP_VERSION: "1.4.0", DATA_DIR: temp, CONFIG_PATH: path.join(temp, "config.json"),
  PLAYER_SETUP_VERSION: 1, PLAYER_SETUP_STATE_KEY: "playerSetup", CONFIG: {},
  readPlayerSetup: () => JSON.parse(JSON.stringify(setup)),
  readPlayerSetupIntifaceCache: () => JSON.parse(JSON.stringify(cache)),
  playerSetupIntifaceCachePath: () => path.join(temp, "intiface-device-cache.json"),
  configForDisk: value => JSON.parse(JSON.stringify(value)),
  readConfig: () => JSON.parse(fs.readFileSync(path.join(temp, "config.json"), "utf8")),
  normalizeConfigForRuntime: value => value,
  validateConfig: value => { value.safety.absoluteMaxIntensity = Math.max(1, Math.min(99, Number(value.safety.absoluteMaxIntensity))); return value; },
  clampPercent: value => Math.max(0, Math.min(100, Math.round(Number(value) || 100))),
  normalizePlayerDevice: value => ({
    provider: value.provider === "intiface" ? "intiface" : "openshock", id: String(value.id || ""), name: String(value.name || ""),
    memberName: String(value.memberName || ""), enabled: value.enabled !== false,
    intensityMultiplier: Math.max(0, Math.min(100, Math.round(Number(value.intensityMultiplier) || 100))),
    preferredTemplate: value.provider === "intiface" ? String(value.preferredTemplate || "soft-wave") : null,
    durationMultiplierOverride: value.durationMultiplierOverride ?? null, notes: String(value.notes || ""), source: "import"
  }),
  getStateValue: () => setup, setStateValue: (_key, value) => { setup = value; },
  writePlayerSetup: value => { setup = value; return value; },
  writePlayerSetupIntifaceCache: value => { if (failCacheWrite) throw new Error("simulated cache failure"); cache = value; return value; },
  writeConfig: value => { fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify(value)); }, invalidateConfigCache: () => {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "server", "modules", "config-transfer.js"), "utf8"), context);

const exported = context.buildConfigTransferExport();
assert.equal(exported.format, "openshock-roulette-config");
assert.equal(exported.schemaVersion, 1);
const serialized = JSON.stringify(exported);
assert(!serialized.includes("never-export"), "API secrets must not be exported");
assert(!serialized.includes("DeviceIndex"), "temporary Intiface indexes must not be exported");
assert(!serialized.includes("websocketUrl"));
assert(!serialized.includes("/tmp/cache.json"));

assert.throws(() => context.createConfigTransferPlan({ ...exported, schemaVersion: 999 }, "merge"), /Unsupported/);
const poisoned = JSON.parse(JSON.stringify(exported));
poisoned.data.gameProfile.safety.apiToken = "bad";
assert.throws(() => context.createConfigTransferPlan(poisoned, "merge"), /Sensitive/);
const pathInjected = JSON.parse(JSON.stringify(exported));
pathInjected.data.gameProfile.safety.outputPath = "/tmp/evil";
assert.throws(() => context.createConfigTransferPlan(pathInjected, "merge"), /paths|field/);

const roundTrip = context.createConfigTransferPlan(exported, "merge");
assert.equal(roundTrip.diff.unresolved.length, 0);
assert.equal(roundTrip.players[0].devices[0].id, "shock-stable");
const clamped = JSON.parse(JSON.stringify(exported));
clamped.data.gameProfile.safety.absoluteMaxIntensity = 500;
assert.equal(context.createConfigTransferPlan(clamped, "merge").diskConfig.safety.absoluteMaxIntensity, 99);

const replacement = JSON.parse(JSON.stringify(exported));
replacement.data.players.players = [{ id: "player:b", name: "Bob", enabled: true }];
replacement.data.deviceMappings.assignments = [];
const replacePlan = context.createConfigTransferPlan(replacement, "replace");
assert.deepEqual(JSON.parse(JSON.stringify(replacePlan.players.map(player => player.id))), ["player:b"]);
assert.equal(replacePlan.players[0].devices.length, 0);

const beforeFailedApply = { setup: JSON.stringify(setup), config: fs.readFileSync(path.join(temp, "config.json"), "utf8") };
const failedPreview = context.previewConfigTransferImport(replacement, "replace");
failCacheWrite = true;
assert.throws(() => context.applyConfigTransferImport(failedPreview.validationId), /rolled back/);
assert.equal(JSON.stringify(setup), beforeFailedApply.setup);
assert.equal(fs.readFileSync(path.join(temp, "config.json"), "utf8"), beforeFailedApply.config);

console.log("Config export/import regression test passed.");
