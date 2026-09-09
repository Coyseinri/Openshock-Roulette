"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const cards=JSON.parse(fs.readFileSync(path.join(root,"config","event-cards.example.json"),"utf8")).cards||[];
const config=JSON.parse(fs.readFileSync(path.join(root,"config","config.example.json"),"utf8"));
const validators=fs.readFileSync(path.join(root,"server","modules","diagnostics-validator-types.js"),"utf8");
const events=fs.readFileSync(path.join(root,"functions","events.js"),"utf8");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const configSource=fs.readFileSync(path.join(root,"server","modules","config.js"),"utf8");

function duplicates(values){const seen=new Set(),dupes=[];for(const value of values){if(seen.has(value))dupes.push(value);seen.add(value);}return dupes;}
assert.deepEqual(duplicates(cards.map(card=>String(card.id).toLowerCase())),[],"Duplicate event-card IDs");
assert.deepEqual(duplicates(cards.map(card=>String(card.title||"").trim().toLowerCase())),[],"Duplicate event-card titles");
const signatures=cards.map(card=>JSON.stringify({targetWheel:!!card.targetWheel,fateWheel:!!card.fateWheel,waitOnly:!!card.waitOnly,effects:card.effects||[]}));
assert.deepEqual(duplicates(signatures),[],"Exact functional duplicate event cards");

const fateKeys=new Set((config.spinners?.fate||[]).map(item=>String(item.key)));
const targetSelectors=new Set(["lastSelected","lastShocked","leastSelected","leastShocked","mostSelected","mostShocked","longestNotSelected","longestNotShocked"]);
for(const card of cards){
  for(const effect of card.effects||[]){
    assert.ok(validators.includes(`"${effect.type}"`),`Unknown/unregistered effect ${effect.type} on ${card.id}`);
    if(["forceFate","multiplyFateWeight"].includes(effect.type) && effect.fateKey) assert.ok(fateKeys.has(String(effect.fateKey)),`Unknown fate key on ${card.id}`);
    if(effect.type==="capFateCategory" && typeof effect.value==="string") assert.ok(fateKeys.has(String(effect.value)),`Unknown fate cap on ${card.id}`);
    if(effect.type==="forceRandomFate") for(const key of effect.fateKeys||[]) assert.ok(fateKeys.has(String(key)),`Unknown random fate key on ${card.id}`);
    if(effect.type==="chooseFateByTarget") for(const choice of effect.choices||[]){
      if(choice.fateKey) assert.ok(fateKeys.has(String(choice.fateKey)),`Unknown choice fate key on ${card.id}`);
      for(const key of choice.forceRandomFateKeys||choice.fateKeys||[]) assert.ok(fateKeys.has(String(key)),`Unknown choice random fate key on ${card.id}`);
    }
    if(effect.type==="multiplyTargetWeight" && effect.selector) assert.ok(targetSelectors.has(String(effect.selector)),`Unknown target selector on ${card.id}`);
  }
}
assert.ok(events.includes("suppressNormalActivation = true"),"Frontend must set replacement-output state");
assert.ok(app.includes("roundState.suppressNormalActivation"),"Main activation path must honor replacement-output state");
assert.ok(configSource.includes("RETIRED_DEFAULT_EVENT_CARD_IDS"),"Existing installations need duplicate retirement migration");
assert.ok(configSource.includes("ADDED_DEFAULT_EVENT_CARD_IDS"),"Existing installations need new default-card merge support");
assert.ok(!cards.some(card=>["nemesis","everybody-hates-safe"].includes(card.id)),"Retired duplicate cards must not ship");
console.log(`Event deck audit passed: ${cards.length} enabled/default cards checked.`);
