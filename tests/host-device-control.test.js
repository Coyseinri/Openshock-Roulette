"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "host", "index.html"), "utf8");
const client = fs.readFileSync(path.join(root, "host", "host.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "server", "modules", "routes.js"), "utf8");

assert.ok(html.includes('id="manualPlayer"'), "Host control must select a logical player");
assert.ok(html.includes('id="manualDevice"'), "Host control must select one assigned device");
assert.ok(client.includes("deviceSelect.selectedOptions[0]?.dataset.provider"), "The selected provider must be sent with the device request");
assert.ok(client.includes("playerId, deviceId, provider, mode: type"), "Host requests must bind player, device, and provider");
assert.ok(routes.includes("controlHostDevice(await readBody(req))"), "The Host endpoint must use the per-device handler");
assert.ok(!routes.includes('url.pathname === "/api/host/control"') || routes.includes("controlHostDevice"));

console.log("Host per-device control wiring regression test passed.");
