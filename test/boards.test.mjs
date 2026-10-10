import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {selectCanvas,useCanvas,appendMedia,archiveMedia,arrangeContent,deleteCanvases,generationParams} from '../src/boards.mjs';

test('native generation details preserve prompts and parameters, resolve reviewed references and exclude private inputs',()=>{
 const params=generationParams({prompt:'requested',model:'requested-model',aspect_ratio:'3:4',resolution:'480p',duration:5,generate_audio:false,reference_images:['asset://approved'],reference_audio:'/private/audio.wav',video_options:{token:'secret',unknown:'private'}},{prompt:'actual',model:'native-model',billingXidou:0,params:{referenceImages:['https://example.com/ref.png','/private/a.png','asset://approved','https://user:password@example.com/a'],duration:'5'}});
 assert.equal(params.prompt,'actual');assert.equal(params.model,'native-model');assert.equal(params.duration,5);assert.equal(params.generateAudio,false);assert.equal(params.aspectRatio,'3:4');assert.equal(params.billingXidou,0);assert.deepEqual(params.referenceImages,['https://example.com/ref.png']);assert.equal(params.token,undefined);assert.equal(params.unknown,undefined);assert.equal(params.referenceAudio,undefined);
});

test('sync enriches existing elements without duplicating or reviving deleted media and is idempotent',()=>{
 const media={id:'details-task',kind:'image',urls:['https://example.com/1.png','https://example.com/2.png']};
 const first=appendMedia('{}',media),old=JSON.parse(first.content);old.elements[0].customData.userNote='keep';old.elements[1].isDeleted=true;
 const enriched=appendMedia(JSON.stringify(old),{...media,generationParams:{prompt:'scene',model:'model',referenceImages:['https://example.com/ref.png']}}),v=JSON.parse(enriched.content);
 assert.equal(enriched.added.length,0);assert.equal(v.elements.length,2);assert.equal(v.elements[0].customData.generationParams.prompt,'scene');assert.equal(v.elements[0].customData.userNote,'keep');assert.equal(v.elements[1].isDeleted,true);assert.equal(v.elements[1].customData.generationParams,undefined);
 assert.equal(appendMedia(enriched.content,{...media,generationParams:v.elements[0].customData.generationParams}).content,enriched.content);
});

test('image and video generation details are hidden on their own elements, without text elements',()=>{
 let content='{}';for(const kind of ['image','video'])content=appendMedia(content,{id:kind,kind,urls:['https://example.com/'+kind],generationParams:{prompt:kind,model:kind,aspectRatio:'3:4',resolution:'1K'}}).content;
 const v=JSON.parse(content);assert.equal(v.elements.length,2);assert(v.elements.every(e=>e.type==='image'));assert.equal(v.elements[0].customData.generationParams.prompt,'image');assert.equal(v.elements[1].customData.generationParams.prompt,'video');
});

test('conversation bindings reuse one board, isolate accounts, allow explicit switching, and never repeat uncertain creation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-test-')),old=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=dir;
 let creates=0,uncertain=false,content='{}';const boards=new Set();
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;const input=raw?JSON.parse(raw):{},send=data=>res.end(JSON.stringify({code:200,data}));res.setHeader('Content-Type','application/json');
  if(req.url==='/api/user/user/info')return send({userUuid:req.headers.authorization||'user'});
  if(req.url.endsWith('/canvas/create')){creates++;if(uncertain)return req.socket.destroy();const id='board-'+creates;boards.add(id);return send({id});}
  if(req.url.includes('/canvas/detail/')){const id=req.url.split('/').at(-1);return send(boards.has(id)?{id,content}:null);}
  if(req.url.includes('suggest-placement'))return send({x:100,y:100});
  if(req.url.endsWith('/canvas/save')){content=input.content;return send(true);}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const cfg={url:new URL('http://127.0.0.1:'+server.address().port),headers:{Authorization:'user-a'}};
 try{
  const [a,b]=await Promise.all([selectCanvas(cfg,null,'conversation-a'),selectCanvas(cfg,null,'conversation-a')]);assert.equal(a.canvas_id,b.canvas_id);assert.equal(creates,1);
  assert.notEqual((await selectCanvas(cfg,null,'conversation-b')).canvas_id,a.canvas_id);
  assert.notEqual((await selectCanvas({...cfg,headers:{Authorization:'user-b'}},null,'conversation-a')).canvas_id,a.canvas_id);
  await useCanvas(cfg,'board-2','conversation-a');assert.equal((await selectCanvas(cfg,null,'conversation-a')).canvas_id,'board-2');assert.equal(creates,3);
  await assert.rejects(selectCanvas(cfg,'missing','conversation-a'),{code:'CANVAS_NOT_FOUND'});assert.equal(creates,3);
  uncertain=true;await assert.rejects(selectCanvas(cfg,null,'uncertain'),{code:'SUBMISSION_UNCERTAIN'});await assert.rejects(selectCanvas(cfg,null,'uncertain'),{code:'SUBMISSION_UNCERTAIN'});assert.equal(creates,4);
  await archiveMedia(cfg,'board-2',{id:'image-task',kind:'image',urls:['https://example.com/a.png']});
  await archiveMedia(cfg,'board-2',{id:'video-task',kind:'video',urls:['https://example.com/a.mp4']});
  await archiveMedia(cfg,'board-2',{id:'image-task',kind:'image',urls:['https://example.com/a.png']});
  assert.equal(JSON.parse(content).elements.length,2);assert.equal(JSON.parse(content).elements[1].customData.isVideoThumbnail,true);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(old===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=old;await fs.rm(dir,{recursive:true});}
});
test('archival preserves canvas data, deleted media and uses non-overlapping coordinates',()=>{
 const media={id:'task',kind:'image',urls:['https://example.com/x.png'],ratio:'3:4'};
 const initial={elements:[{id:'user',x:0,y:0,width:100,height:100}],imageUrlMap:{old:'kept'},appState:{zoom:2},custom:'keep'};
 const next=appendMedia(JSON.stringify(initial),media),v=JSON.parse(next.content);assert.deepEqual(v.appState,initial.appState);assert.equal(v.custom,'keep');assert.equal(v.imageUrlMap.old,'kept');assert(v.elements[1].y>=148);assert.equal(v.elements[1].height,427);
 v.elements[1].isDeleted=true;assert.equal(appendMedia(JSON.stringify(v),media).added.length,0);
});

function noOverlap(elements){for(const [i,a] of elements.entries())for(const b of elements.slice(i+1))assert(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));}
test('mixed media wrap after five, align tops, and use the tallest item for row spacing',()=>{
 let content='{}';for(let i=0;i<12;i++)content=appendMedia(content,{id:'task-'+i,kind:i%2?'video':'image',urls:['https://example.com/'+i],ratio:i%3===0?'1:2':'2:1',order:String(i).padStart(4,'0')}).content;
 const e=JSON.parse(content).elements;assert.equal(e.length,12);assert.equal(e[0].x,0);assert.equal(e[4].y,0);assert.equal(e[5].x,0);assert.equal(e[5].y,688);assert.equal(e[10].x,0);assert.equal(e[10].y,1376);assert.deepEqual(e.slice(0,5).map(v=>v.y),[0,0,0,0,0]);noOverlap(e);
 assert.equal(arrangeContent(content).content,content);
});
test('completion order cannot reorder submission order, and a batch keeps its internal order',()=>{
 let content=appendMedia('{}',{id:'later',kind:'video',urls:['https://example.com/v.mp4'],order:'2026-10-09T02:00:00Z'}).content;
 content=appendMedia(content,{id:'earlier',kind:'image',urls:['https://example.com/1.png','https://example.com/2.png'],order:'2026-10-09T01:00:00Z',placement:{mode:'grid'}}).content;
 const e=JSON.parse(content).elements;assert.equal(e[1].x,0);assert.equal(e[2].x,368);assert.equal(e[0].x,736);noOverlap(e);
});

test('deletion previews exact titles across pages and verifies all backups before DELETE',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-delete-test-')),old=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=dir;
 const boards=new Map([['one',{id:'one',title:'Exact',content:'{}'}],['two',{id:'two',title:'Exact',content:'{}'}],['other',{id:'other',title:'Exact extra',content:'{}'}]]);let deletes=0,failBackup=false;
 const server=http.createServer(async(req,res)=>{
  const send=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data}));};
  if(req.url==='/api/user/user/info')return send({userUuid:'fixture'});
  if(req.url.includes('/canvas/list?')){const page=new URL(req.url,'http://localhost').searchParams.get('pageNum');return send({records:[...boards.values()].filter(b=>page==='1'?b.id!=='two':b.id==='two'),pages:2,current:Number(page)});}
  if(req.url.includes('/canvas/detail/'))return send(boards.get(req.url.split('/').at(-1)));
  if(req.url.includes('/canvas/tasks?')){if(failBackup){res.writeHead(500);return res.end(JSON.stringify({code:500}));}return send([]);}
  if(req.method==='DELETE'){
   const parent=path.join(dir,'canvases','deletion-backups'),folders=await fs.readdir(parent);const entries=await fs.readdir(path.join(parent,folders.at(-1)));assert(entries.includes('one.json')&&entries.includes('two.json'),'both backups must exist before deletion');
   deletes++;boards.delete(req.url.split('/').at(-1));return send(true);
  }
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const cfg={url:new URL('http://127.0.0.1:'+server.address().port),headers:{}};
 try{
  const preview=await deleteCanvases(cfg,{title:'Exact'});assert.equal(preview.count,2);assert.equal(deletes,0);
  await assert.rejects(deleteCanvases(cfg,{title:'Exact',submit:true}),{code:'CONFIRMATION_REQUIRED'});assert.equal(deletes,0);
  failBackup=true;await assert.rejects(deleteCanvases(cfg,{title:'Exact',submit:true,yes:true}),{code:'PROVIDER_FAILURE'});assert.equal(deletes,0);failBackup=false;
  const result=await deleteCanvases(cfg,{title:'Exact',submit:true,yes:true});assert.equal(result.deleted,2);assert.equal(result.remaining,0);assert(boards.has('other'));assert.equal(deletes,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(old===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=old;await fs.rm(dir,{recursive:true});}
});
