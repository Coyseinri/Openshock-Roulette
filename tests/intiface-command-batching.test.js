"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const clientPath = path.join(__dirname, "..", "intiface", "intiface-client.js");
const source = fs.readFileSync(clientPath, "utf8");
const startMarker = "  function featureValueCommands(values) {";
const endMarker = "\n  async function applyTemplateStep";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert.notEqual(start, -1, "featureValueCommands() was not found in intiface-client.js");
assert.notEqual(end, -1, "Could not isolate featureValueCommands() from intiface-client.js");

const functionSource = source.slice(start, end).replace(/^  /gm, "");
const makeMessage = (name, payload = {}) => ({ [name]: payload });
const valueWithDeviceMultiplier = (_device, value) => value;
const legacyMessage = (device, feature, value) => ({
  LegacyCmd: {
    DeviceIndex: Number(device.DeviceIndex),
    Command: feature.command,
    Index: Number(feature.featureIndex),
    Value: value
  }
});

const featureValueCommands = new Function(
  "valueWithDeviceMultiplier",
  "legacyMessage",
  "makeMessage",
  `${functionSource}\nreturn featureValueCommands;`
)(valueWithDeviceMultiplier, legacyMessage, makeMessage);

const device = { DeviceIndex: 7, OSRGeneration: 12 };
const vibration = {
  command: "ScalarCmd",
  featureIndex: 0,
  actuatorType: "Vibrate"
};
const rotation = {
  command: "ScalarCmd",
  featureIndex: 1,
  actuatorType: "Rotate"
};

const commands = featureValueCommands([
  { device, feature: vibration, value: 0.35 },
  { device, feature: rotation, value: 0.6 }
]);

assert.equal(commands.length, 1, "Mixed scalar outputs for one device must be sent in one command envelope");
assert.deepEqual(commands[0], {
  ScalarCmd: {
    DeviceIndex: 7,
    OSRGeneration: 12,
    Scalars: [
      { Index: 0, Scalar: 0.35, ActuatorType: "Vibrate" },
      { Index: 1, Scalar: 0.6, ActuatorType: "Rotate" }
    ]
  }
});

console.log("Intiface scalar batching regression test passed.");
