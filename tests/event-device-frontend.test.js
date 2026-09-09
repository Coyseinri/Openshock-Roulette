"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const events=fs.readFileSync(path.join(root,"functions","events.js"),"utf8");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const cards=JSON.parse(fs.readFileSync(path.join(root,"config","event-cards.example.json"),"utf8"));
const validators=fs.readFileSync(path.join(root,"server","modules","diagnostics-validator-types.js"),"utf8");
assert.ok(events.includes("DEVICE_AWARE_EVENT_EFFECT_TYPES"));
assert.ok(events.includes('/api/event-effects/run'));
assert.ok(app.includes("runDeviceAwareEventEffects(roundState, targets, value)"));
for(const type of ["activateTargetDevices","activateAllToys","activateOtherToys","activateRandomToyPlayers","activateRandomShockPlayers","sequencePlayers","devicePowerModifier","deviceDurationModifier","toyTemplateOverride"]){
 assert.ok(validators.includes(`"${type}"`),`Diagnostics validator missing ${type}`);
}
for(const id of ["hot-potato-toys","collateral-buzz","toy-party"]) assert.ok(cards.cards.some(card=>card.id===id),`Missing event card ${id}`);
assert.equal(cards.cards.find(card=>card.id==="hot-potato-toys").effects.some(effect=>effect.type==="sequencePlayers"),true);
console.log("Device-aware event frontend/config regression test passed.");
