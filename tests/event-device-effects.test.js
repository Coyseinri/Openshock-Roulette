"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const calls={shock:[],toy:[]};
const players=[
 {id:"p1",name:"One",enabled:true,devices:[{provider:"openshock",id:"s1",name:"Shock 1",enabled:true,intensityMultiplier:100},{provider:"intiface",id:"t1",name:"Toy 1",enabled:true,online:true,intensityMultiplier:100}]},
 {id:"p2",name:"Two",enabled:true,devices:[{provider:"intiface",id:"t2",name:"Toy 2",enabled:true,online:true,intensityMultiplier:80}]},
 {id:"p3",name:"Three",enabled:true,devices:[{provider:"openshock",id:"s3",name:"Shock 3",enabled:true,intensityMultiplier:60}]}
];
const context={
 console,require,setTimeout,clearTimeout,Math,
 readSessionState:()=>({eliminatedIds:[]}),
 getConfiguredPlayers:async()=>JSON.parse(JSON.stringify(players)),
 clampInt:(n,min,max)=>Math.max(min,Math.min(max,Math.round(Number(n)||0))),
 clampPercent:n=>Math.max(0,Math.min(100,Math.round(Number(n)||0))),
 safety:()=>({serverMaxShockIntensity:99,defaultDurationMs:700,minDurationMs:300,maxDurationMs:1000}),
 gameIntifaceConfig:()=>({minDurationMs:1000,maxDurationMs:15000}),
 gameToyDurationMs:()=>2800,
 activateOpenShockDevices:async(player,devices,opts)=>{calls.shock.push({player:player.id,devices,opts});return devices.length?{ok:true,devices}:{ok:false,skipped:true,devices:[]};},
 startGameToyRun:(device,opts)=>{calls.toy.push({device,opts});return {ok:true,started:true,maxPowerPercent:25};}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,"..","server","modules","event-device-effects.js"),"utf8"),context);

(async()=>{
 calls.shock.length=calls.toy.length=0;
 let result=await context.runEventDeviceEffects({effects:[{type:"activateTargetToys"}],targetPlayerIds:["p1"],rolledValue:50,shockDurationMs:700});
 assert.equal(result.results[0].results.length,1);
 assert.equal(calls.shock.length,1,"provider helper still returns a skipped OpenShock result");
 assert.equal(calls.shock[0].devices.length,0,"Toy-only primitive must not send Shock devices");
 assert.equal(calls.toy.length,1);
 assert.equal(calls.toy[0].device.id,"t1");

 calls.shock.length=calls.toy.length=0;
 await context.runEventDeviceEffects({effects:[{type:"activateOtherToys"}],targetPlayerIds:["p1"],rolledValue:40,shockDurationMs:700});
 assert.deepEqual(calls.toy.map(c=>c.device.id),["t2"]);

 calls.shock.length=calls.toy.length=0;
 await context.runEventDeviceEffects({effects:[{type:"devicePowerModifier",multiplier:.5},{type:"activateTargetDevices"}],targetPlayerIds:["p1"],rolledValue:50,shockDurationMs:700});
 assert.equal(calls.shock[0].devices[0].intensityMultiplier,50);
 assert.equal(calls.toy[0].device.intensityMultiplier,50);

 const seq=await context.runEventDeviceEffects({effects:[{type:"sequencePlayers",provider:"shock",count:2,delayMs:100}],rolledValue:20,shockDurationMs:700});
 assert.equal(seq.results[0].started,true);
 assert.equal(seq.results[0].provider,"shock");
 assert.equal(seq.results[0].delayMs,1200,"Shock sequence delay must include shock duration plus buffer");
 context.cancelAllEventEffectRuns("test");
 assert.equal(context.activeEventEffectRuns.size,0);
 console.log("Device-aware event effect regression test passed.");
})().catch(err=>{console.error(err);process.exitCode=1;});
