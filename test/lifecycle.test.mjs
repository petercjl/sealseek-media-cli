import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { install, status, hashes, SOURCE, renderSkill } from '../src/skills.mjs';
import { META,hash } from '../src/core.mjs';

test('Skill installation preserves LF and CRLF without adding provider routing policy',()=>{
 for(const newline of ['\n','\r\n']){
  const source=['---','name: fixture','---','Body'].join(newline);
  assert.equal(renderSkill(source,'workbuddy'),source);
  assert.equal(renderSkill(source,'codex'),source);
 }
});

test('managed update migrates package metadata while preserving user Agent routing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-policy-migration-')),target=path.join(dir,'skill');
 const previous=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=path.join(dir,'state');
 try{
  const routing=path.join(dir,'AGENTS.md');await fs.writeFile(routing,'User selected another default media provider.');
  await install('codex',{path:target});
  const yaml=path.join(target,'agents','openai.yaml'),marker=path.join(target,'.sealseek-media-install.json');
  const legacy='interface:\n  display_name: "Legacy"\npolicy:\n  allow_implicit_invocation: false\n';await fs.writeFile(yaml,legacy);
  const manifest=JSON.parse(await fs.readFile(marker,'utf8'));manifest.version='0.0.0';manifest.source='legacy-install';manifest.hashes[path.join('agents','openai.yaml')]=hash(Buffer.from(legacy));await fs.writeFile(marker,JSON.stringify(manifest));
  assert.equal((await status('codex',target)).current,false);
  const updated=await install('codex',{path:target});assert(updated.current);assert.equal(updated.version,META.version);assert(updated.backup);
  assert.equal(await fs.readFile(yaml,'utf8'),await fs.readFile(path.join(SOURCE,'agents','openai.yaml'),'utf8'));
  assert.equal(await fs.readFile(path.join(updated.backup,'agents','openai.yaml'),'utf8'),legacy);
  assert.equal(JSON.parse(await fs.readFile(marker,'utf8')).source,SOURCE);
  assert.equal(await fs.readFile(routing,'utf8'),'User selected another default media provider.');
 }finally{if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(dir,{recursive:true,force:true});}
});

test('install ownership, host routing, edits, backups, locked updates, metadata preservation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-install-test-')),target=path.join(dir,'skill');
 const previous=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=path.join(dir,'state');
 try{
  await assert.rejects(status('unknown',target),{code:'UNKNOWN_TARGET'});
  await fs.mkdir(target);await fs.writeFile(path.join(target,'user.md'),'user-owned');
  await assert.rejects(install('workbuddy',{path:target}),{code:'UNMANAGED_TARGET'});
  await fs.rm(target,{recursive:true});
  let result=await install('workbuddy',{path:target});assert(result.current);assert.equal((await install('workbuddy',{path:target})).state,'unchanged');
  const text=await fs.readFile(path.join(target,'SKILL.md'),'utf8');assert.equal(text,await fs.readFile(path.join(SOURCE,'SKILL.md'),'utf8'));
  const yaml=path.join(target,'agents/openai.yaml');await fs.writeFile(yaml,'interface:\n  display_name: "自定义名称"\n');
  await fs.appendFile(path.join(target,'SKILL.md'),'\n本地修改\n');
  await fs.writeFile(path.join(target,'obsolete.md'),'retired content');
  assert((await status('workbuddy',target)).edited);
  await assert.rejects(install('workbuddy',{path:target}),{code:'LOCAL_EDITS'});
  const rename=async()=>{const error=new Error('fixture lock');error.code='EBUSY';throw error;};
  result=await install('workbuddy',{path:target,force:true,rename});assert(result.current);assert(result.backup);
  assert((await fs.readFile(path.join(result.backup,'SKILL.md'),'utf8')).includes('本地修改'));
  assert((await fs.readFile(yaml,'utf8')).includes('自定义名称'));
  assert.equal(await fs.stat(path.join(target,'obsolete.md')).catch(()=>null),null);
  assert.equal(await fs.readFile(path.join(result.backup,'obsolete.md'),'utf8'),'retired content');
  assert.deepEqual(await fs.readFile(path.join(target,'SKILL.md')),Buffer.from(text));
  assert(Object.keys(await hashes(target)).includes('SKILL.md'));
 }finally{if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(dir,{recursive:true,force:true});}
});
