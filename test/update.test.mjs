import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { META,createJson,readJson } from '../src/core.mjs';
import { performUpdate,newer,settings,installVersion,npmCli,activeWork } from '../src/update.mjs';

async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-update-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('automatic stable update installs once, synchronizes selected Skills and throttles checks',()=>fixture(async dir=>{
 let checks=0,installs=0;const options={dir,root:dir,current:'0.1.2',env:{},isGlobal:async()=>true,busy:async()=>false,targets:async()=>['codex','workbuddy'],latest:async()=>{checks++;return '0.1.3';},install:async(version,targets)=>{installs++;assert.deepEqual(targets,['codex','workbuddy']);return {version};}};
 assert.equal((await settings(dir)).enabled,true);assert.equal((await performUpdate(options)).updated,true);
 assert.equal((await performUpdate(options)).skipped,'not_due');assert.equal(checks,1);assert.equal(installs,1);
 assert.equal((await settings(dir)).installed,'0.1.3');
 assert.equal(newer('0.2.0','0.1.9'),true);assert.equal(newer('0.1.1','0.1.2'),false);assert.equal(newer('1.0.0-beta.1','0.1.2'),false);
}));
test('offline checks, active work, local edits, disabled and Git-owned installations never install',()=>fixture(async dir=>{
 let installs=0;const options={root:dir,env:{},isGlobal:async()=>true,targets:async()=>[],busy:async()=>false,install:async()=>{installs++;},latest:async()=>{throw Object.assign(Error('offline'),{code:'ENETUNREACH'});}};
 const offline=await performUpdate({...options,dir:path.join(dir,'offline')});assert.equal(offline.ok,false);assert.equal(offline.error.code,'ENETUNREACH');assert.equal((await performUpdate({...options,dir:path.join(dir,'offline')})).skipped,'not_due');
 assert.equal((await performUpdate({...options,dir:path.join(dir,'busy'),busy:async()=>true})).skipped,'active_work');
 const edits=await performUpdate({...options,dir:path.join(dir,'edits'),targets:async()=>{throw Object.assign(Error('edited'),{code:'LOCAL_EDITS'});}});assert.equal(edits.error.code,'LOCAL_EDITS');
 assert.equal((await performUpdate({...options,dir:path.join(dir,'off'),env:{SEALSEEK_MEDIA_AUTO_UPDATE:'0'}})).skipped,'disabled');
 await fs.mkdir(path.join(dir,'.git'));assert.equal((await performUpdate({...options,dir:path.join(dir,'git')})).skipped,'development_checkout');
 await assert.rejects(performUpdate({...options,dir:path.join(dir,'manual'),automatic:false}),{code:'DEVELOPMENT_CHECKOUT'});assert.equal(installs,0);
}));
test('update locks prevent duplicate installation and recover abandoned locks',()=>fixture(async dir=>{
 const p=path.join(dir,'update-lock.json');await createJson(p,{owner:META.name,id:'fixture',pid:process.pid});
 const options={dir,root:dir,env:{},isGlobal:async()=>true,targets:async()=>[],busy:async()=>false,latest:async()=> '0.1.2',current:'0.1.2'};
 assert.equal((await performUpdate(options)).skipped,'update_in_progress');
 await fs.unlink(p);await createJson(p,{owner:META.name,id:'fixture',pid:2147483647});assert.equal((await performUpdate(options)).updated,false);
 await assert.rejects(fs.stat(p),{code:'ENOENT'});
}));
test('package installation verifies version, keeps recoverable backups, and preserves evidence after failure',()=>fixture(async dir=>{
 const root=path.join(dir,'package');await fs.mkdir(path.join(root,'bin'),{recursive:true});await createJson(path.join(root,'package.json'),{name:META.name,version:'0.1.2'});await fs.writeFile(path.join(root,'bin/sealseek-media.mjs'),'fixture');
 const options={root,dir:path.join(dir,'state'),npmScript:async()=> 'fixture',execute:async(script,args)=>{assert(args.includes('--ignore-scripts'));await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:META.name,version:'0.1.3'}));},synchronize:async agent=>{assert.equal(agent,'codex');return {status:0};}};
 const result=await installVersion('0.1.3',['codex'],options);assert.equal((await readJson(path.join(result.backup,'package.json'))).version,'0.1.2');assert.deepEqual(result.skills_synchronized,['codex']);
 await assert.rejects(installVersion('0.1.4',[],{...options,execute:async()=>{throw Error('fixture installation failure');}}),e=>{assert(e.details.backup);return true;});
}));
test('npm runtime discovery and real process activity work across platforms',()=>fixture(async dir=>{
 const script=await npmCli();const r=spawnSync(process.execPath,[script,'--version'],{encoding:'utf8'});assert.equal(r.status,0);assert.match(r.stdout,/\d+\.\d+\.\d+/);
 assert.equal(await activeWork(dir),false);await createJson(path.join(dir,'jobs','fixture.json'),{owner:META.name,id:'fixture',status:'running',pid:process.pid});assert.equal(await activeWork(dir),true);
}));
test('real CLI persists automatic update controls without changing provider routing',()=>fixture(async dir=>{
 const entry=new URL('../bin/sealseek-media.mjs',import.meta.url);
 const {fileURLToPath}=await import('node:url');
 const invoke=mode=>{const r=spawnSync(process.execPath,[fileURLToPath(entry),'update','auto',mode,'--json'],{encoding:'utf8',env:{...process.env,SEALSEEK_MEDIA_STATE_DIR:dir}});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout);};
 assert.equal(invoke('status').enabled,true);assert.equal(invoke('off').enabled,false);assert.equal(invoke('status').enabled,false);assert.equal(invoke('on').enabled,true);
 assert.equal((await fs.readdir(path.join(dir,'update-backups'))).length,1);
}));
