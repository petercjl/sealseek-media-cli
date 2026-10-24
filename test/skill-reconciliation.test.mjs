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

test('selected target explicit precedence and historical flag translation',t=>{
 const dir=temp(t);const r=life.resolveTarget({agent:'future-agent',path:path.join(dir,'explicit')},{[life.config.env+'_SKILL_PATH']:path.join(dir,'env')});assert.equal(r.selection_source,'--path');assert.equal(r.target,path.join(dir,'explicit'));
 const parent=path.join(dir,'parent');const result=run(['skill','install','--agent','future-agent','--root',parent,'--mode','link','--json']);assert.equal(result.status,0,result.stdout+result.stderr);const body=JSON.parse(result.stdout);assert.equal(body.target,path.join(parent,life.config.skill));assert.equal(fs.lstatSync(body.target).isSymbolicLink(),false);
});
test('operation status is target scoped, read-only and preserves failure diagnostics',t=>{
 const dir=temp(t),r=target(dir);life.install(r);const m=path.join(r.target,'.agent-package.json'),v=JSON.parse(fs.readFileSync(m));v.version='0.0.0';fs.writeFileSync(m,JSON.stringify(v));
 assert.throws(()=>life.install(r,{rename:()=>{throw Object.assign(Error('failure'),{code:'EIO'});}}));const state=life.operationStatus(r);assert.equal(state.stage,'failed');assert(state.backup);assert.equal(state.skillComplete,false);assert.equal(state.error.code,'EIO');assert(fs.existsSync(path.join(state.backup,'SKILL.md')));
 const before=life.inventory(path.dirname(r.target));life.operationStatus(r,state.id);assert.deepEqual(life.inventory(path.dirname(r.target)),before);assert.throws(()=>life.operationStatus(target(dir,'other'),state.id),{code:'OPERATION_NOT_FOUND'});
});
