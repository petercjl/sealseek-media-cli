import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, META, createJson } from '../src/core.mjs';
import { getJob, jobPath, summary } from '../src/jobs.mjs';

test('lost worker preserves uncertainty and stored output without resubmission', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-media-recovery-'));
 const previous=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=dir;
 try {
  for(const [id,result] of [['11111111-1111-4111-8111-111111111111',null],['22222222-2222-4222-8222-222222222222',{urls:['https://example.com/video.mp4'],count:1}]]) {
   await createJson(jobPath(id),{owner:META.name,id,status:result?'generated':'running',pid:2147483647,started_at:new Date(Date.now()-60000).toISOString(),request:{kind:'video',args:{model:'test'}},result});
   const value=summary(await getJob(id));assert.equal(value.status,result?'download_failed':'uncertain');assert.equal(value.ok,false);assert.equal(value.actual_model,null);
   if(result)assert.deepEqual(value.urls,result.urls);
  }
  const exec=promisify(execFile);
  await assert.rejects(exec(process.execPath,[path.join(ROOT,'bin/sealseek-media.mjs'),'doctor','--config',path.join(dir,'missing.json'),'--json']),e=>e.code===1 && JSON.parse(e.stdout).ok===false);
 } finally { if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(dir,{recursive:true,force:true}); }
});
