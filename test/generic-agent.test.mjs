import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import * as life from '../lifecycle/engine.mjs';
const temp=t=>{const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'managed-lifecycle-')));const key=life.config.env+'_STATE_DIR',prev=process.env[key];process.env[key]=path.join(dir,'state');t.after(()=>{if(prev===undefined)delete process.env[key];else process.env[key]=prev;fs.rmSync(dir,{recursive:true,force:true});});return dir;};
const target=(dir,name='target')=>life.resolveTarget({agent:'future-agent',path:path.join(dir,name)});
const run=(args,env={})=>spawnSync(process.execPath,[path.join(life.root,life.config.entry),...args],{encoding:'utf8',timeout:90000,env:{...process.env,[life.config.env+'_AUTO_UPDATE']:'0',...env}});

test('generic and arbitrary named hosts require explicit own destination before any mutation',t=>{
 const dir=temp(t);for(const agent of ['generic','codex','sealseek','future-agent']){
  assert.throws(()=>life.resolveTarget({agent}),{code:'TARGET_PATH_REQUIRED'});
  assert.equal(life.resolveTarget({agent,path:path.join(dir,agent)}).agent,agent);
 }
 for(const agent of ['../host','Bad Agent','__proto__',''])assert.throws(()=>life.resolveTarget({agent,path:path.join(dir,'x')}),{code:'INVALID_TARGET'});
 assert.throws(()=>life.resolveTarget({path:dir,root:dir}),{code:'CONFLICTING_TARGET'});
 const before=fs.readdirSync(dir);const r=run(['update','install','--yes','--agent','future-agent','--json']);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).code,'TARGET_PATH_REQUIRED');assert.deepEqual(fs.readdirSync(dir),before);
});
test('bootstrap source, duplicate and unknown arguments are read-only',t=>{
 const dir=temp(t),r=run(['skill','source','--json']);assert.equal(r.status,0,r.stderr+r.stdout);const body=JSON.parse(r.stdout);assert.equal(body.source,life.source);assert.equal(body.installationLifecycle.agentNeutral,true);
 for(const a of [['skill','install','--path',dir,'--path',dir],['skill','install','--wat'],['skill','install','--path'],['skill','source','--root',dir],['skill','install','extra','--path',dir]])assert.equal(run(a).status,1,JSON.stringify(a));
 assert.equal(run(['skill','install','--help']).status,0);assert.deepEqual(fs.readdirSync(dir),[]);
});

test('read-only status and version reject mutating or unknown flags before writing',t=>{
 const dir=temp(t),before=fs.readdirSync(dir);const r=run(['update','status','--path',path.join(dir,'target'),'--mode','auto','--yes']);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).code,'INVALID_ARGUMENT');assert.deepEqual(fs.readdirSync(dir),before);
 const version=run(['version','--unknown']);assert.equal(version.status,1);assert.equal(JSON.parse(version.stdout).code,'INVALID_ARGUMENT');
});
