"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const vm=require("node:vm");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"osr-player-setup-"));
const cachePath=path.join(dir,"intiface-device-cache.json");
fs.writeFileSync(cachePath,JSON.stringify({profiles:{toy:{playerId:"shock-a",deviceLabel:"Toy",profile:{intensityMultiplier:30},featureRoles:{}}}}));
let session={playerStats:{"shock-a":{selected:2}},playerMultipliers:{"shock-a":42},intiface:{mappings:{"7":{playerId:"shock-a",cacheKey:"toy"}}},roleAccessKeys:{playerKeys:{"shock-a":"key"}},eliminatedIds:["shock-a"]};
const stateStore={};
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const context={
 console,require,fs,path,DATA_DIR:dir,
 getStateValue:key=>clone(stateStore[key]??null),
 setStateValue:(key,val)=>{stateStore[key]=clone(val);},
 readSessionState:()=>clone(session),
 writeSessionState:st=>{session=clone(st);return clone(session);},
 buildLogicalPlayersFromShockers:()=>[{id:"shock-a",name:"Alice",devices:[{id:"shock-a",name:"Alice",memberName:"Alice"}]}],
 shockerGroupingConfig:()=>({enabled:false,separator:" - ",trimParts:true}),
 splitGroupedShockerName:name=>({grouped:false,groupName:name,memberName:name}),
 CONFIG:{intiface:{enabled:false}},
 getShockers:async()=>({shockers:[]})
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,"..","server","modules","player-setup.js"),"utf8"),context);
const setup=context.buildInitialPlayerSetup([{id:"shock-a",name:"Alice"}]);
assert.ok(setup.players[0].id.startsWith("osr-player:"));
const newId=setup.players[0].id;
assert.equal(session.playerStats[newId].selected,2);
assert.equal(session.playerStats["shock-a"],undefined);
assert.equal(session.playerMultipliers["shock-a"],42,"Physical device multiplier must stay on the device id");
assert.equal(session.intiface.mappings["7"].playerId,newId,"Intiface live mapping must migrate to persistent player id");
const cache=JSON.parse(fs.readFileSync(cachePath,"utf8"));
assert.equal(cache.profiles.toy.playerId,newId,"Intiface cache mapping must migrate to persistent player id");
assert.equal(session.roleAccessKeys.playerKeys[newId],"key");
assert.deepEqual(session.eliminatedIds,[newId]);

// Persistent Intiface identity must not depend on temporary DeviceIndex values.
const stableToyA={DeviceIndex:1,DeviceName:"Motorbunny Buck",DeviceDisplayName:"Buck",DeviceMessages:{ScalarCmd:[{Index:0,ActuatorType:"Vibrate"},{Index:1,ActuatorType:"Rotate"}]}};
const stableToyB={...stableToyA,DeviceIndex:42};
assert.equal(context.stableIntifaceDeviceKey(stableToyA),context.stableIntifaceDeviceKey(stableToyB));
assert.ok(!context.stableIntifaceDeviceKey(stableToyA).includes("42"));

console.log("Player Setup migration regression test passed.");
fs.rmSync(dir,{recursive:true,force:true});
