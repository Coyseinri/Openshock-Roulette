"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const playersSource=fs.readFileSync(path.join(__dirname,"..","functions","players.js"),"utf8");
const start=playersSource.indexOf("function shouldRedirectToPlayerSetup(state = null) {");
const end=playersSource.indexOf("\nfunction buildSessionSnapshot",start);
assert.notEqual(start,-1,"setup redirect helper missing");
assert.notEqual(end,-1,"could not isolate setup redirect helper");
const helperSource=playersSource.slice(start,end);
const shouldRedirect=new Function(`${helperSource}\nreturn shouldRedirectToPlayerSetup;`)();
assert.equal(shouldRedirect({setupCompleted:false,roundNumber:0}),true,"fresh session must enter Player Setup");
assert.equal(shouldRedirect({setupCompleted:true,roundNumber:0}),false,"completed setup must allow the game page");
assert.equal(shouldRedirect({roundNumber:3}),false,"legacy or active mid-game sessions must never be redirected");
assert.equal(shouldRedirect({setupCompleted:false,roundNumber:1}),false,"started game must never redirect to setup");

const dbSource=fs.readFileSync(path.join(__dirname,"..","server","modules","database-session.js"),"utf8");
assert.ok(dbSource.includes("setupCompleted: false"),"fresh/reset session must default setupCompleted to false");
assert.ok(dbSource.includes("setupCompleted: data.setupCompleted === true"),"session validation must normalize setupCompleted");
const setupHtml=fs.readFileSync(path.join(__dirname,"..","setup","index.html"),"utf8");
assert.ok(setupHtml.includes("Start / Continue Game"),"Player Setup must expose a Start / Continue Game action");
const setupJs=fs.readFileSync(path.join(__dirname,"..","setup","setup.js"),"utf8");
assert.ok(setupJs.includes("action:'completeSetup'"),"Start / Continue Game must persist setup completion");
console.log("Player Setup gate regression test passed.");
