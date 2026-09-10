"use strict";

const assert = require("node:assert/strict");
const { requestAccessError, participantPath } = require("../server/request-access");
const { serveStaticFile } = require("../server/static-files");
const { normalizeSafety } = require("../server/output-safety");

function request(rawUrl, method = "GET", headers = {}) {
  return { url: rawUrl, method, headers: { host: "192.168.1.10:3000", ...headers } };
}

assert.equal(participantPath("/player/player.js"), true);
assert.equal(participantPath("/host/stop-all"), false);
assert.equal(participantPath("/api/host/stop-all"), true);
assert.equal(requestAccessError(request("/player/player.js"), new URL("http://192.168.1.10:3000/player/player.js"), false), null);
assert.equal(requestAccessError(request("/"), new URL("http://192.168.1.10:3000/"), false).status, 403);
assert.equal(requestAccessError(request("/player/..%2f.env"), new URL("http://192.168.1.10:3000/player/..%2f.env"), false).status, 403);
assert.equal(requestAccessError(request("/api/host/stop-all", "POST", { origin: "http://evil.test", "content-type": "application/json" }), new URL("http://192.168.1.10:3000/api/host/stop-all"), false).status, 403);

let responseCode = null;
serveStaticFile(request("/.env"), { writeHead(code) { responseCode = code; }, end() {} }, new URL("http://localhost/.env"), {
  appRoot: require("node:path").resolve(__dirname, ".."),
  sendJson(res, code) { res.writeHead(code); res.end(); }
});
assert.equal(responseCode, 403, "Private files must never be served as static assets");

const safety = normalizeSafety({ serverMaxShockIntensity: 150, serverMaxVibrateIntensity: 200, minDurationMs: -5, maxDurationMs: 999999, defaultDurationMs: 999999 });
assert.equal(safety.serverMaxShockIntensity, 99);
assert.equal(safety.serverMaxVibrateIntensity, 100);
assert.equal(safety.minDurationMs, 1);
assert.equal(safety.maxDurationMs, 30000);
assert.equal(safety.defaultDurationMs, 30000);

console.log("Request access and output safety regression test passed.");
