import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { install, status, hashes, SOURCE, renderSkill } from '../src/skills.mjs';

test('install ownership, explicit WorkBuddy policy, edits, backups, locked updates, metadata preservation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-install-test-')),target=path.join(dir,'skill');
 const previous=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=path.join(dir,'state');
 try{
  await assert.rejects(status('unknown',target),{code:'UNKNOWN_TARGET'});
  await fs.mkdir(target);await fs.writeFile(path.join(target,'user.md'),'user-owned');
  await assert.rejects(install('workbuddy',{path:target}),{code:'UNMANAGED_TARGET'});
  await fs.rm(target,{recursive:true});
  let result=await install('workbuddy',{path:target});assert(result.current);assert.equal((await install('workbuddy',{path:target})).state,'unchanged');
  const text=await fs.readFile(path.join(target,'SKILL.md'),'utf8');assert(text.includes('disable-model-invocation: true'));assert(!renderSkill(await fs.readFile(path.join(SOURCE,'SKILL.md'),'utf8'),'codex').includes('disable-model-invocation: true'));
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
