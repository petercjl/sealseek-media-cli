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

test('managed runtime uses current Agent Node without PATH; physical copies preserve Chinese bytes',t=>{
 const dir=temp(t),r=target(dir);let installed=life.install(r);assert.equal(installed.current,true);assert.equal(installed.mode,'copy');assert.equal(fs.lstatSync(r.target).isSymbolicLink(),false);
 assert.deepEqual(fs.readFileSync(path.join(r.target,'SKILL.md')),fs.readFileSync(path.join(life.source,'SKILL.md')));
 const a=fs.statSync(path.join(r.target,'SKILL.md')),b=fs.statSync(path.join(life.source,'SKILL.md'));assert.notEqual(a.ino,b.ino);
 assert.equal(life.status(r).runtimeCurrent,true);assert.equal(life.install(r).changed,false);assert.equal(installed.hostDiscovery,'pending');assert.equal(installed.complete,false);
 const q=spawnSync(process.execPath,[path.join(r.target,'scripts/run.mjs'),'version','--json'],{encoding:'utf8',env:{...process.env,[life.config.env+'_AUTO_UPDATE']:'0',PATH:dir}});assert.equal(q.status,0,q.stderr);assert.equal(JSON.parse(q.stdout).version,life.pkg.version);
});
test('same-version missing/stale resources and receipt repair preserve customized UI',t=>{
 const dir=temp(t),r=target(dir);life.install(r);const marker=path.join(r.target,'.agent-package.json'),record=JSON.parse(fs.readFileSync(marker));record.version='0.0.0';fs.writeFileSync(marker,JSON.stringify(record));
 fs.writeFileSync(path.join(r.target,'agents/openai.yaml'),'interface:\n  display_name: 自定义名称\n');
 fs.unlinkSync(path.join(r.target,'SKILL.md'));const repaired=life.update(r,{yes:true,version:life.pkg.version});assert.equal(repaired.changed,true);assert(repaired.backup);assert.equal(life.status(r).current,true);assert(fs.readFileSync(path.join(r.target,'agents/openai.yaml'),'utf8').includes('自定义名称'));
 assert.equal(life.update(r,{yes:true,version:life.pkg.version}).changed,false);
});
test('unmanaged targets, business/runtime edits and untracked files are preserved',t=>{
 const dir=temp(t),owned=target(dir,'user');fs.mkdirSync(owned.target);fs.writeFileSync(path.join(owned.target,'mine'),'owned');assert.throws(()=>life.install(owned),{code:'UNMANAGED_TARGET'});
 const r=target(dir);life.install(r);const file=path.join(r.target,'SKILL.md'),bytes=fs.readFileSync(file);fs.appendFileSync(file,'user edit');assert.throws(()=>life.install(r),{code:'LOCAL_EDITS'});assert(fs.readFileSync(file,'utf8').endsWith('user edit'));fs.writeFileSync(file,bytes);
 fs.writeFileSync(path.join(r.target,'mine.txt'),'keep');assert.throws(()=>life.install(r),{code:'UNMANAGED_FILE'});fs.unlinkSync(path.join(r.target,'mine.txt'));
 const runtime=path.join(r.target,'.runtime',life.config.entry);fs.appendFileSync(runtime,'\n// local edit');assert.throws(()=>life.install(r),{code:'LOCAL_EDITS'});
});
test('managed legacy link migrates with true Skill/package snapshots and metadata',t=>{
 const dir=temp(t),r=target(dir);try{fs.symlinkSync(life.source,r.target,process.platform==='win32'?'junction':'dir');}catch(e){if(e.code==='EPERM')return t.skip('Symlink privilege unavailable');throw e;}
 assert.equal(life.status(r).current,false);const result=life.install(r);assert.equal(result.migration,true);assert.equal(fs.lstatSync(r.target).isSymbolicLink(),false);assert(fs.existsSync(path.join(result.backup,'SKILL.md')));const operation=life.operationStatus(r,result.operationId);assert(fs.existsSync(path.join(operation.packageBackup,'package.json')));assert.equal(life.status(r).current,true);
});
test('locked-directory updates preserve complete backup and untouched other target',t=>{
 const dir=temp(t),r=target(dir),other=target(dir,'other');life.install(r);life.install(other);const before=life.inventory(other.target);
 const m=path.join(r.target,'.agent-package.json'),v=JSON.parse(fs.readFileSync(m));v.version='0.0.0';fs.writeFileSync(m,JSON.stringify(v));
 const result=life.install(r,{rename:()=>{throw Object.assign(Error('live host directory lock'),{code:'EPERM'});}});assert(result.backup);assert.equal(life.status(r).current,true);assert.deepEqual(life.inventory(other.target),before);
});
test('malformed ownership and UI metadata are refused without replacement',t=>{
 const dir=temp(t),r=target(dir);life.install(r);const m=path.join(r.target,'.agent-package.json'),v=JSON.parse(fs.readFileSync(m));v.hashes['../escape']='0'.repeat(64);fs.writeFileSync(m,JSON.stringify(v));assert.throws(()=>life.install(r),{code:'UNMANAGED_STATE'});
 delete v.hashes['../escape'];fs.writeFileSync(m,JSON.stringify(v));fs.writeFileSync(path.join(r.target,'agents/openai.yaml'),'[invalid');assert.throws(()=>life.install(r),{code:'SKILL_METADATA_INVALID'});
});

test('active media work defers replacement while same-version verified no-op stays available',t=>{
 const dir=temp(t),r=target(dir);life.install(r);const job=path.join(process.env.SEALSEEK_MEDIA_STATE_DIR,'jobs','fixture.json');fs.mkdirSync(path.dirname(job),{recursive:true});fs.writeFileSync(job,JSON.stringify({owner:life.pkg.name,status:'running',pid:process.pid,created_at:new Date().toISOString()}));
 assert.equal(life.activeWork(),true);assert.equal(life.install(r).changed,false);
 const file=path.join(r.target,'.agent-package.json'),value=JSON.parse(fs.readFileSync(file));value.version='0.0.0';fs.writeFileSync(file,JSON.stringify(value));
 assert.throws(()=>life.install(r),{code:'ACTIVE_WORK'});assert.throws(()=>life.update(r,{yes:true,version:life.pkg.version}),{code:'ACTIVE_WORK'});
 fs.unlinkSync(job);assert.equal(life.activeWork(),false);assert.equal(life.install(r).current,true);
});

test('local edits through a managed legacy link are preserved before migration',t=>{
 const dir=temp(t),owner=path.join(dir,'legacy-package'),legacy=path.join(owner,'skills',life.config.skill);fs.mkdirSync(path.dirname(legacy),{recursive:true});fs.cpSync(life.source,legacy,{recursive:true});
 fs.writeFileSync(path.join(owner,'package.json'),JSON.stringify({name:life.pkg.name,version:life.pkg.version,files:['skills']}));fs.writeFileSync(path.join(owner,'skill-integrity.json'),JSON.stringify(life.inventory(legacy)));
 const exact=path.join(dir,'linked');try{fs.symlinkSync(legacy,exact,process.platform==='win32'?'junction':'dir');}catch(e){if(e.code==='EPERM')return t.skip('Symlink privilege unavailable');throw e;}
 fs.appendFileSync(path.join(legacy,'SKILL.md'),'\nuser edit through link\n');const resolution=life.resolveTarget({path:exact,'legacy-source':owner});assert.equal(life.status(resolution).edited,true);assert.throws(()=>life.install(resolution),{code:'LOCAL_EDITS'});assert.equal(fs.lstatSync(exact).isSymbolicLink(),true);assert(fs.readFileSync(path.join(legacy,'SKILL.md'),'utf8').includes('user edit through link'));
});

test('verified dead-owner lock is recovered while a live owner is preserved',t=>{
 const dir=temp(t),r=target(dir);life.install(r);const finished=spawnSync(process.execPath,['-e',''],{encoding:'utf8'});assert.equal(finished.status,0);const lock=r.target+'.package-lock';fs.writeFileSync(lock,JSON.stringify({package:life.pkg.name,pid:finished.pid}),{flag:'wx'});assert.equal(life.install(r).changed,false);
 fs.writeFileSync(lock,JSON.stringify({package:life.pkg.name,pid:process.pid}),{flag:'wx'});assert.throws(()=>life.install(r),{code:'UPDATE_BUSY'});assert.equal(JSON.parse(fs.readFileSync(lock)).pid,process.pid);fs.unlinkSync(lock);
});

test('typed maintenance receipts preserve legacy fields and report actual edit paths',t=>{
 const dir=temp(t),r=target(dir);life.install(r);
 const discovered=run(['skill','source','--json']);assert.equal(discovered.status,0);const info=JSON.parse(discovered.stdout);assert.equal(info.name,life.config.skill);assert.equal(info.maintenanceContract.status.edited.type,'string[]');
 const clean=life.status(r);assert.equal(clean.edited,false);assert.deepEqual(clean.editedFiles,[]);assert.equal(clean.verification.verified,true);assert.equal(clean.recovery.action,'host-discovery');
 fs.appendFileSync(path.join(r.target,'SKILL.md'),'\nlocal edit');const edited=life.status(r);assert.equal(edited.edited,true);assert(edited.editedFiles.includes('SKILL.md'));assert.equal(edited.verification.verified,false);assert.equal(edited.recovery.action,'preserve-local-edits');
});

test('published Windows legacy receipt paths migrate safely and reject ambiguous paths',t=>{
 const dir=temp(t),r=target(dir),fixture=()=>{fs.mkdirSync(r.target,{recursive:true});fs.cpSync(life.source,r.target,{recursive:true});const hashes=Object.fromEntries(Object.entries(life.inventory(r.target)).map(([key,value])=>[key.replaceAll('/','\\'),value]));fs.writeFileSync(path.join(r.target,life.config.legacyMarker),JSON.stringify({owner:life.pkg.name,version:'0.6.8',hashes}));};
 fixture();assert.equal(life.status(r).edited,false);assert.equal(life.install(r).current,true);
 const second=target(dir,'unsafe');fs.mkdirSync(second.target);const marker=path.join(second.target,life.config.legacyMarker),digest='0'.repeat(64);
 for(const hashes of [{'a/b':digest,'a\\b':digest},{'..\\escape':digest},{'C:\\outside':digest}]){fs.writeFileSync(marker,JSON.stringify({owner:life.pkg.name,version:'0.6.8',hashes}));assert.throws(()=>life.status(second),{code:'UNMANAGED_STATE'});}
});
