import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {mapLimited} from '../src/concurrency.mjs';
import {prepare,execute} from '../src/media.mjs';
import {CATALOG} from '../src/models.mjs';
import {toolsFor,pollTask} from '../src/canvas.mjs';
import {timingSummary,DEFAULT_TASK_TIMEOUT,worker,jobPath,getJob} from '../src/jobs.mjs';
import {META,createJson} from '../src/core.mjs';
import {accountScope} from '../src/boards.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('bounded preparation drains active work on failure and never schedules remaining inputs',async()=>{
 let release;const barrier=new Promise(r=>release=r),started=[],finished=[];
 const promise=mapLimited([0,1,2,3],async i=>{started.push(i);if(i===0)throw Error('rejected');await barrier;finished.push(i);return i;});
 let settled=false;promise.catch(()=>{settled=true;});await delay(10);assert.equal(settled,false);assert.deepEqual(started,[0,1]);release();await assert.rejects(promise,/rejected/);assert.deepEqual(finished,[1]);
});

test('real HTTP reference preparation overlaps two uploads, preserves order and never reviews image generation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-parallel-'));let active=0,maxActive=0,posts=0;const calls=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;calls.push(req.url);let data;
  if(req.url.endsWith('/common/upload')){active++;maxActive=Math.max(maxActive,active);const name=/filename="(ref-\d.png)"/.exec(raw)[1];await delay(name==='ref-0.png'?70:20);active--;data='https://example.com/'+name;}
  else if(req.url.endsWith('/tasks/generate')){posts++;assert.equal(active,0);assert.deepEqual(JSON.parse(raw).images,[0,1,2].map(i=>`https://example.com/ref-${i}.png`));data={taskId:'remote'};}
  else data={status:'done',images:['https://example.com/output.png']};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const refs=[];for(let i=0;i<3;i++){const p=path.join(dir,`ref-${i}.png`);await fs.writeFile(p,Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from([i])]),{flag:'wx'});refs.push(p);}
  const c={cfg:{url:new URL('http://127.0.0.1:'+server.address().port),headers:{}},tools:toolsFor(CATALOG),canvasId:'canvas'};
  await execute(c,await prepare('image',{prompt:'test',reference:refs},c.tools,CATALOG),1000);
  assert.equal(maxActive,2);assert.equal(posts,1);assert.equal(calls.filter(v=>v.includes('/ark/')).length,0);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('default tracking follows a task past 15 minutes; progress exposes only safe status',async t=>{
 let now=0,reads=0;const events=[];
 const server=http.createServer((req,res)=>{reads++;if(reads===1)now+=901000;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data:{status:reads===1?'running':'done',privateField:'secret'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.mock.method(Date,'now',()=>now);
 try{
  assert.equal(DEFAULT_TASK_TIMEOUT,1800);
  const result=await pollTask({url:new URL('http://127.0.0.1:'+server.address().port),headers:{}},'remote',{timeout:DEFAULT_TASK_TIMEOUT*1000,interval:0,onProgress:e=>events.push(e)});
  assert.equal(result.status,'done');assert.deepEqual(events,[{status:'running'},{status:'done'}]);assert.equal(reads,2);
  now=0;reads=0;await assert.rejects(pollTask({url:new URL('http://127.0.0.1:'+server.address().port),headers:{}},'remote',{timeout:900000,interval:0}),{code:'SUBMISSION_UNCERTAIN'});assert.equal(reads,1);
 }finally{t.mock.restoreAll();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('parallel person references reuse identical review identity and failed review drains peers without generating',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-parallel-review-')),previous=process.env.SEALSEEK_MEDIA_STATE_DIR;
 process.env.SEALSEEK_MEDIA_STATE_DIR=dir;let rejected=false,reviewPosts=0,statusReads=0,generations=0,peerFinished=false;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):{};let data;
  const active=id=>({status:'Active',compliant:true,assetId:id,assetUri:'asset://'+id});
  if(req.url.endsWith('/auto-review')){
   reviewPosts++;const id=new URL(input.url).pathname.slice(1,-4);
   if(rejected&&id==='bad')data={status:'Failed',compliant:false,reason:'rejected'};
   else {await delay(30);peerFinished=true;data=active(id);}
  }else if(req.url.endsWith('/ark/status')){statusReads++;data=active(input.assetId);}
  else if(req.url.endsWith('/tasks/generate')){generations++;assert.deepEqual(input.videoParams.referenceImages,['asset://person-a','asset://person-a','asset://person-b']);data={taskId:'remote'};}
  else data={status:'done',videos:['https://example.com/result.mp4']};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const c={cfg:{url:new URL('http://127.0.0.1:'+server.address().port),headers:{}},tools:toolsFor(CATALOG),canvasId:'canvas'};
  const prepareVideo=refs=>prepare('video',{prompt:'test',reference:refs.map(v=>'https://example.com/'+v+'.png'),'reference-person':refs.map(()=>'present')},c.tools,CATALOG);
  await execute(c,await prepareVideo(['person-a','person-a','person-b']),1000);assert.equal(reviewPosts,2);assert.equal(statusReads,1);assert.equal(generations,1);
  rejected=true;peerFinished=false;const before=reviewPosts;
  await assert.rejects(execute(c,await prepareVideo(['bad','peer','unstarted']),1000),{code:'ASSET_REVIEW_FAILED'});
  assert.equal(peerFinished,true);assert.equal(reviewPosts-before,2);assert.equal(generations,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(dir,{recursive:true,force:true});}
});

test('phase timing is observational, resume gaps remain included, old jobs have unknown phase durations',()=>{
 const base='2026-10-21T00:00:';
 const timing=timingSummary({created_at:base+'00Z',completed_at:base+'20Z',timings:{submitted_at:base+'02Z',remote_completed_at:base+'19Z',references_started_at:base+'01Z',references_completed_at:base+'02Z'}});
 assert.deepEqual(timing.durations_ms,{preparation:2000,references:1000,remote_wait:17000,finalization:1000,total:20000});assert.equal(timing.source,'client-observed');
 assert.deepEqual(timingSummary({}).durations_ms,{preparation:null,references:null,remote_wait:null,finalization:null,total:null});
});

test('optimized worker rejects account changes before upload; resumed worker keeps identity and original timing without POST',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-account-resume-')),previous=process.env.SEALSEEK_MEDIA_STATE_DIR;
 process.env.SEALSEEK_MEDIA_STATE_DIR=dir;let changed=false;const calls=[];
 const server=http.createServer((req,res)=>{
  calls.push({method:req.method,route:req.url});let data;
  if(req.url.endsWith('/generation-models'))data={image:CATALOG.models.filter(m=>m.type==='image'),video:CATALOG.models.filter(m=>m.type==='video')};
  else if(req.url.endsWith('/api/user/user/info'))data={userUuid:changed?'other-user':'original-user'};
  else {assert.equal(req.method,'GET');assert(req.url.endsWith('/tasks/existing-remote'));data={status:'done',videos:['https://example.com/result.mp4']};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url='http://127.0.0.1:'+server.address().port,config=path.join(dir,'config.json');
  await fs.writeFile(config,JSON.stringify({mcp:{servers:{'sealseek-canvas':{url:url+'/mcp',headers:{Authorization:'Bearer fixture'}}}}}),{flag:'wx'});
  const scope=await accountScope({url:new URL(url),headers:{}});
  const original='2026-10-21T00:00:00.000Z',submitted='2026-10-21T00:00:01.000Z';
  const base={owner:META.name,status:'queued',created_at:original,started_at:original,timeout:10,configOptions:{config},request:{kind:'video',archive:'none',account_scope:scope,args:{model:'doubao-seedance-2-5'},refs:[]}};
  const rejected='33333333-3333-4333-8333-333333333333';await createJson(jobPath(rejected),{...base,id:rejected});changed=true;await worker(rejected);
  assert.equal((await getJob(rejected)).error.code,'AUTH_REJECTED');assert.equal(calls.filter(v=>v.method==='POST').length,0);
  changed=false;const resumed='44444444-4444-4444-8444-444444444444';await createJson(jobPath(resumed),{...base,id:resumed,resume_only:true,remote:{remote_task_id:'existing-remote',canvasId:'canvas'},timings:{submitted_at:submitted}});await worker(resumed);
  const done=await getJob(resumed);assert.equal(done.status,'succeeded');assert.equal(done.started_at,original);assert.equal(done.timings.submitted_at,submitted);assert.equal(done.remote.remote_task_id,'existing-remote');assert.equal(done.remote_status,'done');assert.equal(calls.filter(v=>v.method==='POST').length,0);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(dir,{recursive:true,force:true});}
});
