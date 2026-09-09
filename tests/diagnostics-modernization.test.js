"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const diag=fs.readFileSync(path.join(root,"server","modules","diagnostics.js"),"utf8");
const html=fs.readFileSync(path.join(root,"diagnostics.html"),"utf8");

for(const needle of [
  "buildDiagnosticsPlayerReadiness",
  "buildDiagnosticsEventCompatibility",
  "getPlayerSetupState({ forceRefresh: false })",
  "getOutputStatusSnapshot(players)",
  '"intiface-connected"',
  '"toy-mapping"',
  '"toy-templates"',
  '"device-assignments"',
  "stopAllGameOutputs([])",
  "testSetupDevice",
  "activateGamePlayer",
  "diagnosticsTestPreview"
]) assert.ok(diag.includes(needle),`Missing diagnostics integration: ${needle}`);

assert.ok(html.includes("Players & Devices"),"Diagnostics tab should use logical-player terminology");
assert.ok(html.includes("Unified Safe Test Controls"),"Diagnostics should expose unified tests");
assert.ok(html.includes("Intiface / Toy Inspector"),"Diagnostics should expose Toy inspector");
assert.ok(html.includes("Event / Hardware Compatibility"),"Diagnostics should expose event compatibility");
assert.ok(html.includes("STOP ALL OUTPUTS"),"Diagnostics should expose unified Stop All");
assert.ok(html.includes("Preview Plan"),"Diagnostics tests should support non-output preview");
assert.ok(!diag.includes('description: `Stop sent to ${ids.length} device(s)`'),"Old OpenShock-only diagnostics Stop All must be gone");
console.log("Diagnostics logical-player/Toy regression test passed.");

assert.ok(diag.includes("const usable = active.filter(device => device.online && device.mappingReady && device.templateValid);"),"0% profiles must warn without blocking readiness");
assert.ok(diag.includes("requiresAny"),"provider=any event compatibility must accept either provider");

assert.ok(diag.includes("Shock test is not valid for an individual Toy"),"Diagnostics must reject provider-incompatible active tests");
assert.ok(html.includes("Normal outcome / Shock value"),"Logical-player test label must describe mixed-provider behavior");
