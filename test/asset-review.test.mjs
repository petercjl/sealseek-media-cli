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
 const calls=[];const server=http.createServer(async(req,res)=>{res.setHeader('Connection','close');let body='';for await(const p of req)body+=p;const call={route:req.url,data:body&&req.headers['content-type']?.includes('application/json')?JSON.parse(body):null};calls.push(call);try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data:await run(call,calls)}));}catch(e){res.statusCode=500;res.end(JSON.stringify({code:500,msg:e.message}));}});
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
  await fixture(async call=>{
   if(call.route.endsWith('/auto-review')||call.route.endsWith('/ark/status')){
    const id=call.data.assetId||(call.data.url.includes('first')?'asset-first':'asset-last');
    // Complete the last frame first: network completion order must not change
    // the frame roles passed to generation.
    if(id==='asset-first')await new Promise(r=>setTimeout(r,30));
    return {...active,assetId:id,assetUri:'asset://'+id};
   }
   return call.route.endsWith('/canvas/create')?{id:'canvas'}:call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',videos:['https://example.com/result.mp4'],images:['https://example.com/result.png']};
  },async(c,o)=>{c.canvasId='canvas';
   const req=await prepare('video',{model:'doubao-seedance-2-0',prompt:'test',duration:5,first:'https://example.com/first.png',last:'https://example.com/last.png','first-person':'present','last-person':'present'},c.tools,CATALOG);
   assert.equal(o.calls.length,0,'dry-run preparation must not review or upload');assert(req.reference_review.automatic);
   const reviews=[];c.onReferenceReview=v=>reviews.push(v);await execute(c,req,1000);
   const submitted=o.calls.find(v=>v.route.endsWith('/tasks/generate'));assert.equal(submitted.data.firstFrameImage,'asset://asset-first');assert.equal(submitted.data.lastFrameImage,'asset://asset-last');assert.deepEqual(reviews.map(v=>v.role).sort(),['first','last']);assert.equal(o.calls.filter(v=>v.route.endsWith('/tasks/generate')).length,1);
   const before=o.calls.filter(v=>v.route.endsWith('/auto-review')).length;await execute(c,await prepare('image',{prompt:'test',reference:['https://example.com/image.png']},c.tools,CATALOG),1000);assert.equal(o.calls.filter(v=>v.route.endsWith('/auto-review')).length,before);
  });
  await fixture(()=>({status:'Failed',reason:'multiple faces',compliant:false}),async(c,o)=>{await assert.rejects(execute(c,await prepare('video',{prompt:'test',reference:['https://example.com/bad.png'],'reference-person':['present']},c.tools,CATALOG),1000),{code:'ASSET_REVIEW_FAILED'});assert.equal(o.calls.length,1);});
 }finally{if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(state,{recursive:true,force:true});}
});

test('mixed video references review only people, preserving ordinary product/scene URLs and order',async()=>{
 const previous=process.env.SEALSEEK_MEDIA_STATE_DIR;const state=await fs.mkdtemp(path.join(os.tmpdir(),'media-mixed-'));process.env.SEALSEEK_MEDIA_STATE_DIR=state;
 try{await fixture(call=>call.route.endsWith('/auto-review')||call.route.endsWith('/ark/status')?active:call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',videos:['https://example.com/out.mp4']},async(c,o)=>{
  c.canvasId='canvas';const refs=['https://example.com/product.png','https://example.com/person.png','https://example.com/scene.png'];
  const req=await prepare('video',{prompt:'test',reference:refs,'reference-person':['absent','present','absent']},c.tools,CATALOG);
  assert.equal(o.calls.length,0);const events=[];c.onReferenceReview=r=>events.push(r);await execute(c,req,1000);
  assert.deepEqual(o.calls.filter(v=>v.route.endsWith('/auto-review')).map(v=>v.data.url),[refs[1]]);
  assert.deepEqual(o.calls.find(v=>v.route.endsWith('/tasks/generate')).data.videoParams.referenceImages,[refs[0],active.assetUri,refs[2]]);
  assert.deepEqual(events.sort((a,b)=>a.index-b.index).map(v=>v.status),['Skipped','Active','Skipped']);
 });}finally{if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(state,{recursive:true,force:true});}
});

test('non-person first and last frames never invoke asset endpoints',async()=>{
 await fixture(call=>{assert(!call.route.includes('/ark/'));return call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',videos:['https://example.com/out.mp4']};},async(c,o)=>{
  c.canvasId='canvas';const first='https://example.com/product.png',last='https://example.com/scene.png';
  await execute(c,await prepare('video',{model:'doubao-seedance-2-0',prompt:'test',first,last,'first-person':'absent','last-person':'absent'},c.tools,CATALOG),1000);
  const sent=o.calls.find(v=>v.route.endsWith('/tasks/generate'));assert.equal(sent.data.firstFrameImage,first);assert.equal(sent.data.lastFrameImage,last);
 });
});

test('missing/invalid classifications stop before side effects, including unclassified older jobs',async()=>{
 await fixture(()=>{throw new Error('Unexpected network');},async(c,o)=>{
  const base={prompt:'test',reference:['https://example.com/a.png','https://example.com/b.png']};
  for(const extra of [{},{'reference-person':['absent']},{'reference-person':['absent','unknown']}])
   await assert.rejects(prepare('video',{...base,...extra},c.tools,CATALOG),e=>['REFERENCE_CLASSIFICATION_REQUIRED','INVALID_INPUT'].includes(e.code));
  await assert.rejects(prepare('video',{prompt:'test','first-person':'absent'},c.tools,CATALOG),{code:'INVALID_INPUT'});
  const job=await prepare('video',{...base,'reference-person':['absent','absent']},c.tools,CATALOG);delete job.refs[1].person;
  await assert.rejects(execute(c,job,1000),{code:'REFERENCE_CLASSIFICATION_REQUIRED'});assert.equal(o.calls.length,0);
 });
});

test('portrait image generation and dedicated edits never touch any asset endpoint, even with failed review service',async()=>{
 await fixture(call=>{assert(!call.route.includes('/ark/'),'Image operations must never request review or status');return /\/tasks\/generate$|\/quickEditRun$|\/editText$/.test(call.route)?{taskId:'remote'}:{status:'done',images:['https://example.com/out.png']};},async(c,o)=>{
  c.canvasId='canvas';
  for(const [model,operation] of [['gpt-image-2.5-sunburst',null],['nano-banana2.1',null],['nano-banana-pro','quick-edit'],['nano-banana-pro','replace-text']]){
   const req=await prepare('image',{model,prompt:'Portrait of the person in the reference',reference:['https://example.com/portrait.png']},c.tools,CATALOG);
   if(operation){req.operation=operation;req.edit_params={oldText:'old',newText:'new'};}
   await execute(c,req,1000);
  }
  assert.equal(o.calls.filter(v=>/\/tasks\/generate$|\/quickEditRun$|\/editText$/.test(v.route)).length,4);
  await assert.rejects(prepare('image',{prompt:'test','reference-person':['present']},c.tools,CATALOG),{code:'FEATURE_UNSUPPORTED'});
 });
});

test('local non-person video and portrait image references upload for generation only',async()=>{
 await fixture(call=>{
  assert(!call.route.includes('/ark/'));
  return call.route.endsWith('/common/upload')?'https://example.com/upload.png':call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',images:['https://example.com/out.png'],videos:['https://example.com/out.mp4']};
 },async(c,o)=>{
  c.canvasId='canvas';const file=path.join(o.cacheDirectory,'input.png');await fs.writeFile(file,Buffer.from('89504e470d0a1a0a','hex'),{flag:'wx'});
  for(const kind of ['video','image']){
   const req=await prepare(kind,{prompt:'test',reference:[file],...(kind==='video'?{'reference-person':['absent']}:{})},c.tools,CATALOG);
   await execute(c,req,1000);
  }
  assert.equal(o.calls.filter(v=>v.route.endsWith('/common/upload')).length,2);
  assert.equal(o.calls.filter(v=>v.route.endsWith('/tasks/generate')).length,2);
  const req=await prepare('video',{prompt:'test',reference:[file],'reference-person':['absent']},c.tools,CATALOG);
  await fs.writeFile(file,'changed');const before=o.calls.length;await assert.rejects(execute(c,req,1000),{code:'REFERENCE_CHANGED'});assert.equal(o.calls.length,before);
 });
});


async function withVideoReviewState(fn){
 const previous=process.env.SEALSEEK_MEDIA_STATE_DIR,dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-video-review-'));
 process.env.SEALSEEK_MEDIA_STATE_DIR=dir;
 try{await fn();}finally{if(previous===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=previous;await fs.rm(dir,{recursive:true,force:true});}
}

test('video URL references are reviewed as Video before generation; product images stay ordinary URLs',async()=>{
 await withVideoReviewState(async()=>fixture(call=>{
  if(call.route.endsWith('/auto-review')){assert.equal(call.data.assetType,'Video');return active;}
  return call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',videos:['https://example.com/out.mp4']};
 },async(c,o)=>{
  c.canvasId='canvas';const req=await prepare('video',{prompt:'test',reference:['https://example.com/product.png'],'reference-person':['absent'],'video-reference':['https://example.com/input.mp4']},c.tools,CATALOG);
  assert.equal(o.calls.length,0);const reviews=[];c.onReferenceReview=r=>reviews.push(r);await execute(c,req,1000);
  const sent=o.calls.find(v=>v.route.endsWith('/tasks/generate'));
  assert.deepEqual(sent.data.videoParams.referenceVideos,[active.assetUri]);assert.deepEqual(sent.data.images,['https://example.com/product.png']);
  assert.equal(o.calls.filter(v=>v.route.endsWith('/auto-review')).length,1);assert(reviews.some(r=>r.role==='video'&&r.status==='Active'));
  assert.equal(o.calls.filter(v=>v.route.endsWith('/tasks/generate')).length,1);
 }));
});

test('approved video asset URI is status-checked and reused without upload or registration',async()=>{
 await withVideoReviewState(async()=>fixture(call=>{
  assert(!call.route.endsWith('/common/upload'));assert(!call.route.endsWith('/auto-review'));
  if(call.route.endsWith('/ark/status')){assert.equal(call.data.assetId,'asset-test');return active;}
  return call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',videos:['https://example.com/out.mp4']};
 },async(c,o)=>{
  c.canvasId='canvas';await execute(c,await prepare('video',{prompt:'test','video-reference':[active.assetUri]},c.tools,CATALOG),1000);
  assert.equal(o.calls.filter(v=>v.route.endsWith('/ark/status')).length,1);
  assert.deepEqual(o.calls.find(v=>v.route.endsWith('/tasks/generate')).data.videoParams.referenceVideos,[active.assetUri]);
  await assert.rejects(prepare('video',{prompt:'test','audio-reference':active.assetUri},c.tools,CATALOG),{code:'FEATURE_UNSUPPORTED'});
 }));
});

test('video review rejection blocks generation with no raw video fallback',async()=>{
 await withVideoReviewState(async()=>fixture(call=>call.route.endsWith('/auto-review')?{status:'Failed',compliant:false,reason:'Rejected video'}:call.route.endsWith('/tasks/generate')?{taskId:'remote'}:{status:'done',videos:['https://example.com/out.mp4']},async(c,o)=>{
  c.canvasId='canvas';await assert.rejects(execute(c,await prepare('video',{prompt:'test','video-reference':['https://example.com/rejected.mp4']},c.tools,CATALOG),1000),e=>e.code==='ASSET_REVIEW_FAILED'&&e.details.role==='video');
  assert.equal(o.calls.filter(v=>v.route.endsWith('/tasks/generate')).length,0);
 }));
});

test('image and video reviews have distinct cache identities; video cache is revalidated',async()=>{
 await fixture(call=>active,async(c,o)=>{
  const ref={url:'https://example.com/shared'},opts={...o,upload:async()=>ref.url};
  await reviewReference(c,ref,{...opts,role:'reference'});await reviewReference(c,ref,{...opts,role:'video'});await reviewReference(c,ref,{...opts,role:'video'});
  assert.deepEqual(o.calls.filter(v=>v.route.endsWith('/auto-review')).map(v=>v.data.assetType),['Image','Video']);
  assert.equal(o.calls.filter(v=>v.route.endsWith('/ark/status')).length,1);
 });
});
