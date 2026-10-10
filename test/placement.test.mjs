import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {appendMedia,arrangeContent} from '../src/boards.mjs';
import {validatePlacement,archiveOptions} from '../src/placement.mjs';
import {summary} from '../src/jobs.mjs';

const item=(id,placement)=>({id,kind:'image',urls:[`https://example.com/${id}.jpg`],placement});
test('append preserves manually moved existing media and all unrelated elements',()=>{
  const v=JSON.parse(appendMedia('{}',item('a')).content);
  Object.assign(v.elements[0],{x:700,y:900,angle:0.2});
  v.elements.push({id:'user',type:'rectangle',x:0,y:0,width:200,height:200});
  const before=structuredClone(v.elements);
  const next=JSON.parse(appendMedia(JSON.stringify(v),item('b')).content);
  assert.deepEqual(next.elements.slice(0,2),before);
  assert.equal(next.elements[2].customData.fileMimeType,'image/jpeg');
});
test('explicit batch placement honors each position and size, and replays add no elements',()=>{
  const media={id:'batch',kind:'video',urls:['https://example.com/a.mp4','https://example.com/b.mp4'],placement:{mode:'explicit',positions:[{x:-40,y:100,width:600,height:800},{x:700,y:100,width:200,height:400}]}};
  const next=appendMedia('{}',media),v=JSON.parse(next.content);
  assert.deepEqual(v.elements.map(({x,y,width,height})=>({x,y,width,height})),media.placement.positions);
  assert.equal(appendMedia(next.content,media).content,next.content);
  assert.throws(()=>appendMedia(next.content,{...media,urls:['https://example.com/changed.mp4',media.urls[1]]}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>appendMedia('{}',{...media,urls:[media.urls[0]]}),{code:'INVALID_INPUT'});
});
test('append supports configurable rows and dimensions, grid is an explicit reflow',()=>{
  let content='{}';
  for(let i=0;i<5;i++)content=appendMedia(content,item(String(i),{columns:2,gap:10,width:100,height:50})).content;
  const e=JSON.parse(content).elements;
  assert.deepEqual(e.map(v=>[v.x,v.y]),[[0,0],[110,0],[0,60],[110,60],[0,120]]);
  const next=JSON.parse(arrangeContent(content,{}, {columns:3,gap:20}).content).elements;
  assert.deepEqual(next.map(v=>[v.x,v.y]),[[0,0],[120,0],[240,0],[0,70],[120,70]]);
});
test('invalid layouts and contradictory archive inputs fail before mutation',async()=>{
  for(const value of [{columns:0},{gap:-1},{width:Infinity},{mode:'explicit',positions:[{x:0,y:NaN}]},{x:10},{positions:[{x:0,y:0}]}])assert.throws(()=>validatePlacement(value),{code:'INVALID_INPUT'});
  assert.equal((await archiveOptions({archive:'none'})).archive,'none');
  await assert.rejects(archiveOptions({archive:'none',placement:'unused.json'}),{code:'INVALID_INPUT'});
  const result=summary({id:'id',status:'succeeded',request:{kind:'image',archive:'none',args:{model:'model'}},result:{urls:['https://example.com/a.png'],count:1}});
  assert.equal(result.archive,'none');assert.equal(result.canvas_saved,null);
});
test('canvas add CLI dry-run validates without authentication, and errors on invalid URLs',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-add-'));
  try{
    const file=path.join(dir,'media.json');await fs.writeFile(file,JSON.stringify(item('import',{mode:'explicit',positions:[{x:20,y:30}]})),{flag:'wx'});
    const run=()=>spawnSync(process.execPath,['bin/sealseek-media.mjs','canvas','add','board-id','--media',file,'--json'],{encoding:'utf8',env:{...process.env,SEALSEEK_MEDIA_AUTO_UPDATE:'0'}});
    let r=run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).dry_run,true);
    await fs.writeFile(file,JSON.stringify({...item('import'),urls:['file:///private/data']}));
    r=run();assert.notEqual(r.status,0);
  }finally{await fs.rm(dir,{recursive:true});}
});

test('append avoids the projected bounds of rotated elements',()=>{
  const content=JSON.stringify({elements:[{id:'rotated',type:'rectangle',x:0,y:0,width:100,height:1000,angle:Math.PI/2}]});
  const e=JSON.parse(appendMedia(content,item('after-rotation')).content).elements.at(-1);
  assert(e.y>=550+48);
});
