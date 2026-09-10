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
assert.ok(app.includes("runDeviceAwareEventEffects(roundState, targets, value, outputRunToken)"));
assert.ok(events.includes("outputRunToken"),"Event effects must carry the output-run token");
for(const type of ["suppressNormalActivation","activateTargetDevices","activateAllToys","activateOtherToys","activateRandomToyPlayers","activateRandomShockPlayers","sequencePlayers","devicePowerModifier","deviceDurationModifier","toyTemplateOverride"]){
 assert.ok(validators.includes(`"${type}"`),`Diagnostics validator missing ${type}`);
}
for(const id of ["hot-potato-toys","collateral-buzz","toy-party","everybody-but-you","buzz-roulette","buzz-buddies","chain-reaction","long-game","short-fuse","random-buzz","toy-takeover","crossfire","split-decision","reverse-split","mixed-hot-potato","shock-and-buzz","shock-potato","random-tax","repeat-performance","dealers-mercy","loaded-crowd"]) assert.ok(cards.cards.some(card=>card.id===id),`Missing event card ${id}`);
assert.ok(!cards.cards.some(card=>card.id==="nemesis"),"Nemesis duplicate should be retired");
assert.ok(!cards.cards.some(card=>card.id==="everybody-hates-safe"),"Everybody Hates Safe duplicate should be retired");
const toyParty=cards.cards.find(card=>card.id==="toy-party");
assert.ok(toyParty.effects.some(effect=>effect.type==="suppressNormalActivation"),"Toy Party must replace normal physical output");
assert.equal(cards.cards.find(card=>card.id==="hot-potato-toys").effects.some(effect=>effect.type==="sequencePlayers"),true);
console.log("Device-aware event frontend/config regression test passed.");
