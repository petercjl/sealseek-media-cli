import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {reviewReference} from '../src/asset-review.mjs';
import {execute,prepare,reference} from '../src/media.mjs';
import {CATALOG} from '../src/models.mjs';
import {toolsFor} from '../src/canvas.mjs';
import {hash} from '../src/core.mjs';

const active={status:'Active',compliant:true,assetId:'asset-test',assetUri:'asset://asset-test'};
async function fixture(run,fn){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-review-'));
 const calls=[];const server=http.createServer(async(req,res)=>{res.setHeader('Connection','close');let body='';for await(const p of req)body+=p;const call={route:req.url,data:body?JSON.parse(body):null};calls.push(call);try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data:await run(call,calls)}));}catch(e){res.statusCode=500;res.end(JSON.stringify({code:500,msg:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const c={cfg:{url:new URL('http://127.0.0.1:'+server.address().port),headers:{}},tools:toolsFor(CATALOG)};
 try{await fn(c,{calls,cacheDirectory:dir});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
}
test('review waits for Active, persists identity and revalidates cache without another upload',async()=>{
 let uploads=0,posts=0,reads=0;const events=[];
 await fixture(call=>{if(call.route.endsWith('/auto-review')){posts++;return {...active,status:'Processing',compliant:undefined};}reads++;return active;},async(c,o)=>{
  c.onReferenceReview=e=>events.push(e);const ref={url:'https://example.com/reference.png'};const opts={...o,upload:async()=>{uploads++;return ref.url;},interval:1};
  assert.equal(await reviewReference(c,ref,opts),active.assetUri);assert.equal(await reviewReference(c,ref,opts),active.assetUri);
  assert.equal(uploads,1);assert.equal(posts,1);assert.equal(reads,2);assert.equal(events.at(-1).cached,true);
  c.cfg.headers={Authorization:'different-account'};await reviewReference(c,ref,opts);assert.equal(posts,2);
 });
});
test('failed, malformed and pending reviews never become raw reference fallbacks',async()=>{
 for(const [result,code] of [[{status:'Failed',compliant:false,reason:'Rejected'},'ASSET_REVIEW_FAILED'],[{...active,assetUri:'asset://different'},'ASSET_REVIEW_INVALID_RESPONSE'],[{status:'Processing',assetId:'asset-test'},'ASSET_REVIEW_PENDING']]){
  await fixture(()=>result,async(c,o)=>{await assert.rejects(reviewReference(c,{url:'https://example.com/r.png'},{...o,upload:async()=> 'https://example.com/r.png',timeout:code==='ASSET_REVIEW_PENDING'?3000:30000,interval:3000}),{code});assert(o.calls.every(v=>!v.route.includes('/tasks/generate')));});
 }
});
test('unreadable review response is not replayed and reports that video has not been submitted',async()=>{
 let posts=0;const server=http.createServer((req,res)=>{posts++;res.setHeader('Connection','close');res.end('invalid provider response');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-uncertain-review-'));
 try{await assert.rejects(reviewReference({cfg:{url:new URL('http://127.0.0.1:'+server.address().port),headers:{}}},{url:'https://example.com/uncertain.png'},{cacheDirectory:dir,upload:async()=> 'https://example.com/uncertain.png'}),e=>e.code==='ASSET_REVIEW_UNCERTAIN'&&e.details.generation_submitted===false);assert.equal(posts,1);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
test('approved URI input is checked; changed local file cannot reuse a cached review',async()=>{
 await fixture(()=>active,async(c,o)=>{
  let uploads=0;const opts={...o,upload:async()=>{uploads++;return 'https://example.com/r.png';}};
  assert.equal(await reviewReference(c,await reference(active.assetUri),opts),active.assetUri);assert.equal(uploads,0);
  const file=path.join(o.cacheDirectory,'reference.png');await fs.writeFile(file,'original',{flag:'wx'});const ref={file,digest:hash('original')};await reviewReference(c,ref,opts);
  await fs.writeFile(file,'changed');await assert.rejects(reviewReference(c,ref,opts),{code:'REFERENCE_CHANGED'});
 });
});
test('video preflight reviews first and last frames before one generation; image generation stays unchanged',async()=>{
 const previous=process.env.SEALSEEK_MEDIA_STATE_DIR;const state=await fs.mkdtemp(path.join(os.tmpdir(),'media-execute-'));process.env.SEALSEEK_MEDIA_STATE_DIR=state;
 try{
  await fixture(call=>call.route.endsWith('/auto-review')||call.route.endsWith('/ark/status')?active:call.route.endsWith('/canvas/create')?{id:'canvas'}:call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',videos:['https://example.com/result.mp4'],images:['https://example.com/result.png']},async(c,o)=>{c.canvasId='canvas';
   const req=await prepare('video',{model:'doubao-seedance-2-0',prompt:'test',duration:5,first:'https://example.com/first.png',last:'https://example.com/last.png'},c.tools,CATALOG);
   assert.equal(o.calls.length,0,'dry-run preparation must not review or upload');assert(req.reference_review.automatic);
   const reviews=[];c.onReferenceReview=v=>reviews.push(v);await execute(c,req,1000);
   const submitted=o.calls.find(v=>v.route.endsWith('/tasks/generate'));assert.equal(submitted.data.firstFrameImage,active.assetUri);assert.equal(submitted.data.lastFrameImage,active.assetUri);assert.deepEqual(reviews.map(v=>v.role),['first','last']);assert.equal(o.calls.filter(v=>v.route.endsWith('/tasks/generate')).length,1);
   const before=o.calls.filter(v=>v.route.endsWith('/auto-review')).length;await execute(c,await prepare('image',{prompt:'test',reference:['https://example.com/image.png']},c.tools,CATALOG),1000);assert.equal(o.calls.filter(v=>v.route.endsWith('/auto-review')).length,before);
  });
  await fixture(()=>({status:'Failed',reason:'multiple faces',compliant:false}),async(c,o)=>{await assert.rejects(execute(c,await prepare('video',{prompt:'test',reference:['https://example.com/bad.png']},c.tools,CATALOG),1000),{code:'ASSET_REVIEW_FAILED'});assert.equal(o.calls.length,1);});
 }finally{if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(state,{recursive:true,force:true});}
});
