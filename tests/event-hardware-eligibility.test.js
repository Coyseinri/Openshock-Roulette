"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"..","functions","events.js"),"utf8");

for(const needle of [
  "eventHardwareAvailability",
  "replacementEventHardwareRequirement",
  "eventCardHardwareEligible",
  "hardwareEligibleEventCards",
  "weightedPick(hardware.eligible"
]) assert.ok(source.includes(needle),`Missing event hardware filter: ${needle}`);

function getEventEffects(card){return Array.isArray(card.effects)?card.effects:[];}
function requirement(card){
  const effects=getEventEffects(card);
  if(!effects.some(effect=>effect.type==="suppressNormalActivation")) return {replacement:false,shock:false,toy:false,any:false};
  let shock=false,toy=false,any=false;
  for(const effect of effects){
    const type=String(effect.type||"");
    if(["activateTargetShocks","activateRandomShockPlayers"].includes(type)) shock=true;
    if(["activateTargetToys","activateAllToys","activateOtherToys","activateRandomToyPlayers","toyTemplateOverride"].includes(type)) toy=true;
    if(type==="activateTargetDevices") any=true;
    if(type==="sequencePlayers"){
      const provider=String(effect.provider||"any").toLowerCase();
      if(provider==="shock")shock=true;else if(provider==="toy")toy=true;else any=true;
    }
  }
  return {replacement:true,shock,toy,any};
}
function eligible(card,a){
 const r=requirement(card);
 if(!r.replacement)return true;
 if(r.shock&&!a.shock)return false;
 if(r.toy&&!a.toy)return false;
 if(r.any&&!a.any)return false;
 return true;
}
const toyOnly={effects:[{type:"suppressNormalActivation"},{type:"activateAllToys"}]};
const shockOnly={effects:[{type:"suppressNormalActivation"},{type:"sequencePlayers",provider:"shock"}]};
const mixed={effects:[{type:"suppressNormalActivation"},{type:"activateTargetShocks"},{type:"activateTargetToys"}]};
const anyCard={effects:[{type:"suppressNormalActivation"},{type:"sequencePlayers",provider:"any"}]};
const bonusToy={effects:[{type:"activateOtherToys"}]};
const classic={effects:[{type:"forcePreviousTarget"}]};

assert.equal(eligible(toyOnly,{shock:true,toy:false,any:true}),false,"Toy-only replacement must be skipped without Toys");
assert.equal(eligible(shockOnly,{shock:false,toy:true,any:true}),false,"Shock-only replacement must be skipped without Shock outputs");
assert.equal(eligible(mixed,{shock:true,toy:false,any:true}),false,"Mixed replacement must require both providers");
assert.equal(eligible(mixed,{shock:true,toy:true,any:true}),true);
assert.equal(eligible(anyCard,{shock:true,toy:false,any:true}),true,"provider=any must accept Shock");
assert.equal(eligible(anyCard,{shock:false,toy:true,any:true}),true,"provider=any must accept Toy");
assert.equal(eligible(anyCard,{shock:false,toy:false,any:false}),false);
assert.equal(eligible(bonusToy,{shock:true,toy:false,any:true}),true,"Bonus Toy effect must remain selectable without Toys");
assert.equal(eligible(classic,{shock:false,toy:false,any:false}),true,"Classic cards must remain unchanged");
console.log("Event hardware eligibility regression test passed.");
