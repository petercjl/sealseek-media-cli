import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, META, createJson, readJson } from '../src/core.mjs';
import { install, status, hashes } from '../src/skills.mjs';
import { performUpdate, resolveUpdateTarget, invocationTarget, managedTargets, installVersion } from '../src/update.mjs';
const NEXT=META.version.replace(/\d+$/,value=>String(Number(value)+1));

async function fixture(fn) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-reconcile-'));
  const before=process.env.SEALSEEK_MEDIA_STATE_DIR;
  process.env.SEALSEEK_MEDIA_STATE_DIR=path.join(dir,'state');
  try { await fn(dir); }
  finally { if(before===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=before;await fs.rm(dir,{recursive:true,force:true}); }
}
async function stale(target,agent='custom-agent') {
  await install(agent,{path:target});
  const marker=path.join(target,'.sealseek-media-install.json');
  const value=await readJson(marker);value.version='0.0.0';
  await fs.writeFile(marker,JSON.stringify(value));
}
function options(dir,target) {
  return {root:dir,dir:path.join(dir,'state'),env:{},target,current:META.version,isGlobal:async()=>true,busy:async()=>false,latest:async()=>META.version,install:async()=>assert.fail('Current package must not be reinstalled')};
}

test('latest package repairs only selected custom Skill with backup; repeat is a verified no-op',()=>fixture(async dir=>{
  const target=path.join(dir,'自定义 Agent','skills','sealseek-media'),other=path.join(dir,'other');
  await stale(target);await stale(other,'different-agent');
  const otherHashes=await hashes(other),marker=await fs.readFile(path.join(other,'.sealseek-media-install.json'));
  const result=await performUpdate(options(dir,resolveUpdateTarget({agent:'custom-agent',path:target},{})));
  assert.equal(result.updated,false);assert.equal(result.skill_sync.receipts[0].current,true);
  assert.equal(result.skill_sync.receipts[0].state,'installed');
  assert.equal((await readJson(path.join(result.skill_sync.receipts[0].backup,'.sealseek-media-install.json'))).version,'0.0.0');
  assert.deepEqual(await hashes(other),otherHashes);assert.deepEqual(await fs.readFile(path.join(other,'.sealseek-media-install.json')),marker);
  const again=await performUpdate({...options(dir,result.skill_sync.target),latest:async()=>assert.fail('Registry must be cached')});
  assert.equal(again.skipped,'not_due');assert.equal(again.skill_sync.receipts[0].state,'unchanged');
}));

test('daily registry cache and offline registry do not skip local Skill reconciliation',()=>fixture(async dir=>{
  const target=path.join(dir,'target');await stale(target);
  await createJson(path.join(dir,'state','updates.json'),{owner:META.name,id:'updates',enabled:true,last_check:Date.now()});
  const binding=resolveUpdateTarget({path:target},{});
  const result=await performUpdate({...options(dir,binding),latest:async()=>assert.fail('No registry call expected')});
  assert.equal(result.skipped,'not_due');assert.equal(result.skill_sync.receipts[0].state,'installed');
  await stale(target);
  const offline=await performUpdate({...options(dir,binding),now:Date.now()+86400001,latest:async()=>{throw Object.assign(Error('offline'),{code:'ENETUNREACH'});}});
  assert.equal(offline.ok,false);assert.equal(offline.error.code,'ENETUNREACH');assert.equal(offline.skill_sync.receipts[0].current,true);
}));

test('target selection is explicit, generic and isolated; malformed bindings fail before writes',()=>fixture(async dir=>{
  const env={SEALSEEK_MEDIA_AGENT:'custom-agent',SEALSEEK_MEDIA_SKILL_PATH:path.join(dir,'env')};
  assert.equal(resolveUpdateTarget({},env).selection_source,'environment');
  assert.equal(resolveUpdateTarget({agent:'codex'},env).path,path.join(os.homedir(),'.codex','skills','sealseek-media'));
  assert.equal(resolveUpdateTarget({path:path.join(dir,'flags')},env).agent,'generic');
  assert.equal(resolveUpdateTarget({},{}),null);assert.deepEqual(await managedTargets(null),[]);
  assert.equal(invocationTarget(['capabilities','--agent=custom-agent','--skill-path',path.join(dir,'x'),'--json'],{}).target.agent,'custom-agent');
  for(const argv of [['--agent'],['--skill-path','--json'],['--agent','codex','--agent','other'],['--agent','../invalid','--skill-path',dir],['--skill-path=']])assert.throws(()=>invocationTarget(argv,{}));
  assert.equal(await fs.stat(path.join(dir,'state')).catch(()=>null),null);
}));

test('selected edited, unmanaged and missing targets retain their contents and ownership',()=>fixture(async dir=>{
  const target=path.join(dir,'target');await stale(target);await fs.appendFile(path.join(target,'SKILL.md'),'\nuser edit\n');
  const before=await hashes(target);
  const edited=await performUpdate(options(dir,resolveUpdateTarget({path:target},{})));
  assert.equal(edited.error.code,'LOCAL_EDITS');assert.deepEqual(await hashes(target),before);
  const owned=path.join(dir,'owned');await fs.mkdir(owned);await fs.writeFile(path.join(owned,'SKILL.md'),'user-owned');
  const unmanaged=await performUpdate(options(dir,resolveUpdateTarget({path:owned},{})));
  assert.equal(unmanaged.error.code,'UNMANAGED_TARGET');assert.equal(await fs.readFile(path.join(owned,'SKILL.md'),'utf8'),'user-owned');
  const missing=path.join(dir,'missing');const result=await performUpdate(options(dir,resolveUpdateTarget({path:missing},{})));
  assert.equal(result.skill_sync.skipped,'not_installed');assert.equal(await fs.stat(missing).catch(()=>null),null);
}));

test('manual same-version maintenance reconciles selected Skill; disabled, active and locked operations defer',()=>fixture(async dir=>{
  const target=path.join(dir,'target');await stale(target);const binding=resolveUpdateTarget({path:target},{});
  assert.equal((await performUpdate({...options(dir,binding),env:{SEALSEEK_MEDIA_AUTO_UPDATE:'0'}})).skipped,'disabled');
  assert.equal((await performUpdate({...options(dir,binding),busy:async()=>true})).skipped,'active_work');
  await createJson(path.join(dir,'state','update-lock.json'),{owner:META.name,id:'test',pid:process.pid});
  assert.equal((await performUpdate(options(dir,binding))).skipped,'update_in_progress');
  await fs.unlink(path.join(dir,'state','update-lock.json'));
  assert.equal((await status('generic',target)).current,false);
  const result=await performUpdate({...options(dir,binding),automatic:false});assert.equal(result.skill_sync.receipts[0].current,true);
}));

test('malformed managed manifest and synchronization failure cannot report success',()=>fixture(async dir=>{
  const target=path.join(dir,'target');await stale(target);
  const marker=path.join(target,'.sealseek-media-install.json'),value=await readJson(marker);delete value.hashes;
  await fs.writeFile(marker,JSON.stringify(value));const contents=await fs.readFile(marker);
  const bad=await performUpdate(options(dir,resolveUpdateTarget({path:target},{})));
  assert.equal(bad.error.code,'UNMANAGED_STATE');assert.deepEqual(await fs.readFile(marker),contents);
  const failed=await performUpdate({...options(dir,null),targets:async()=>['fixture'],reconcile:async()=>{throw Object.assign(Error('failed sync'),{code:'SKILL_SYNC_FAILED'});}});
  assert.equal(failed.ok,false);assert.equal(failed.error.code,'SKILL_SYNC_FAILED');
}));

test('new package installation synchronizes the exact custom target through the new CLI',()=>fixture(async dir=>{
  const root=path.join(dir,'package'),target=path.join(dir,'target'),other=path.join(dir,'other');await fs.mkdir(root);
  for(const name of ['src','bin','skills','package.json','node_modules'])await fs.cp(path.join(ROOT,name),path.join(root,name),{recursive:true,dereference:true});
  await stale(target);await stale(other,'different-agent');const otherMarker=await fs.readFile(path.join(other,'.sealseek-media-install.json'));
  const result=await installVersion(NEXT,[resolveUpdateTarget({agent:'custom-agent',path:target},{})],{root,dir:path.join(dir,'state'),npmScript:async()=>'',execute:async()=>{const file=path.join(root,'package.json'),meta=await readJson(file);meta.version=NEXT;await fs.writeFile(file,JSON.stringify(meta));}});
  assert.equal((await readJson(path.join(result.backup,'package.json'))).version,META.version);
  assert.equal((await readJson(path.join(target,'.sealseek-media-install.json'))).version,NEXT);
  assert.deepEqual(await fs.readFile(path.join(other,'.sealseek-media-install.json')),otherMarker);
}));

test('packed-style real CLI repairs cached custom target via flags and env, preserves metadata and refuses local edits',()=>fixture(async dir=>{
  const global=path.join(dir,'global'),root=path.join(global,...META.name.split('/'));
  await fs.mkdir(root,{recursive:true});
  for(const name of ['src','bin','skills','package.json','node_modules'])await fs.cp(path.join(ROOT,name),path.join(root,name),{recursive:true,dereference:true});
  const npmScript=path.join(dir,'npm-cli.js');await fs.writeFile(npmScript,`process.stdout.write(${JSON.stringify(global)});`);
  const state=path.join(dir,'state');await createJson(path.join(state,'updates.json'),{owner:META.name,id:'updates',enabled:true,last_check:Date.now()});
  const target=path.join(dir,'custom'),other=path.join(dir,'other');await stale(target);await stale(other,'another-agent');
  const sidecar=path.join(target,'agents','openai.yaml');await fs.appendFile(sidecar,'\n# customized UI metadata\n');
  const customMetadata=await fs.readFile(sidecar);
  const marker=await fs.readFile(path.join(other,'.sealseek-media-install.json'));
  const cli=(args,extra={})=>spawnSync(process.execPath,[path.join(root,'bin','sealseek-media.mjs'),...args],{encoding:'utf8',env:{...process.env,SEALSEEK_MEDIA_AUTO_UPDATE:'1',SEALSEEK_MEDIA_STATE_DIR:state,npm_execpath:npmScript,SEALSEEK_MEDIA_AGENT:'another-agent',SEALSEEK_MEDIA_SKILL_PATH:other,...extra}});
  const first=cli(['capabilities','--agent','custom-agent','--skill-path',target,'--json']);
  assert.equal(first.status,0,first.stdout+first.stderr);assert.equal(JSON.parse(first.stdout).ok,true);
  assert.equal(JSON.parse(first.stderr.trim()).auto_update.reload_skill,true);
  const reportedSource=(await readJson(path.join(target,'.sealseek-media-install.json'))).source;
  assert.equal(await fs.realpath(reportedSource),await fs.realpath(path.join(root,'skills','sealseek-media')));
  assert.deepEqual(await fs.readFile(sidecar),customMetadata);assert.deepEqual(await fs.readFile(path.join(other,'.sealseek-media-install.json')),marker);
  const again=cli(['capabilities','--agent','custom-agent','--skill-path',target,'--json']);assert.equal(again.status,0);assert.equal(again.stderr,'');
  const second=cli(['capabilities','--json']);assert.equal(second.status,0);assert.equal(JSON.parse(second.stderr.trim()).auto_update.skill_sync.target.selection_source,'environment');
  await fs.appendFile(path.join(target,'SKILL.md'),'\nlocal edit\n');
  const refusal=cli(['capabilities','--agent','custom-agent','--skill-path',target,'--json']);assert.equal(refusal.status,1);assert.equal(JSON.parse(refusal.stdout).error.code,'LOCAL_EDITS');
  const prior=await fs.readFile(path.join(state,'updates.json'));
  const invalid=cli(['capabilities','--agent','bad/name','--skill-path',target,'--json']);assert.equal(invalid.status,1);assert.deepEqual(await fs.readFile(path.join(state,'updates.json')),prior);
  // Read-only discovery ignores even an incomplete maintenance binding.
  assert.equal(cli(['version'],{SEALSEEK_MEDIA_AGENT:'custom-agent',SEALSEEK_MEDIA_SKILL_PATH:undefined}).status,0);
  assert.equal(cli(['skill','source','--json']).status,0);
  // Simulate registry/package replacement, retaining the actual new CLI entry.
  await fs.writeFile(path.join(state,'updates.json'),JSON.stringify({owner:META.name,id:'updates',enabled:true,last_check:0}));
  const hook=path.join(dir,'registry-hook.mjs');
  await fs.writeFile(hook,`globalThis.fetch=async()=>new Response(JSON.stringify({name:${JSON.stringify(META.name)},version:${JSON.stringify(NEXT)}}),{status:200});`);
  const installs=path.join(dir,'npm-installs.jsonl');
  await fs.writeFile(npmScript,`const fs=require('node:fs');if(process.argv[2]==='root')process.stdout.write(${JSON.stringify(global)});else if(process.argv[2]==='install'){const p=${JSON.stringify(path.join(root,'package.json'))};const d=JSON.parse(fs.readFileSync(p));d.version=${JSON.stringify(NEXT)};fs.writeFileSync(p,JSON.stringify(d));fs.appendFileSync(${JSON.stringify(installs)},'installed\\n');}else process.exitCode=1;`);
  const upgraded=cli(['capabilities','--agent','another-agent','--skill-path',other,'--json'],{NODE_OPTIONS:`--import=${pathToFileURL(hook).href}`});
  assert.equal(upgraded.status,0,upgraded.stdout+upgraded.stderr);
  assert.equal(JSON.parse(upgraded.stdout).version,NEXT);
  assert.equal(upgraded.stdout.trim().split('\n').filter(line=>line==='{').length,1);
  assert.equal(await fs.readFile(installs,'utf8'),'installed\n');
  assert.equal((await readJson(path.join(other,'.sealseek-media-install.json'))).version,NEXT);
  assert.match(upgraded.stderr,/"reload_skill":true/);
}));
