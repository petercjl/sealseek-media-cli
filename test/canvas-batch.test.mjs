import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCanvasBatch} from '../src/boards.mjs';
const batch=()=>({frames:[{id:'f',name:'店铺',x:100,y:200,width:800,height:900}],media:[{id:'a',kind:'image',urls:['https://example.com/a.png'],frameId:'f',placement:{mode:'explicit',positions:[{x:120,y:220,width:320,height:500}]},sourceMetadata:{productId:'1',category:'main_images'}}]});
test('native frame batch saves absolute member coordinates and replays unchanged',()=>{const b=batch(),v=applyCanvasBatch('{}',b),r=JSON.parse(v.content);assert.equal(v.added_frames,1);assert.equal(v.added_media,1);assert.equal(r.elements[0].type,'frame');assert.equal(r.elements[1].frameId,'f');assert.equal(r.elements[1].x,120);assert.equal(r.elements[1].customData.sourceMetadata.productId,'1');const replay=applyCanvasBatch(v.content,b);assert.equal(replay.added_media,0);assert.equal(replay.content,v.content);});
test('conflicting frame, placement, unknown frame and out-of-frame bounds reject',()=>{const b=batch(),v=applyCanvasBatch('{}',b);const conflict=batch();conflict.frames[0].name='different';assert.throws(()=>applyCanvasBatch(v.content,conflict),{code:'IDEMPOTENCY_CONFLICT'});const bad=batch();bad.media[0].placement.positions[0].x=99;assert.throws(()=>applyCanvasBatch('{}',bad),{code:'INVALID_INPUT'});bad.media[0].frameId='missing';assert.throws(()=>applyCanvasBatch('{}',bad),{code:'INVALID_INPUT'});});
test('external video poster is retained with original playable video URL',()=>{const b=batch();b.media[0].kind='video';b.media[0].urls=['https://example.com/a.mp4'];b.media[0].posterUrl='https://example.com/poster.jpg';const e=JSON.parse(applyCanvasBatch('{}',b).content).elements[1];assert.equal(e.customData.fileUrl,'https://example.com/poster.jpg');assert.equal(e.customData.videoUrl,'https://example.com/a.mp4');});

test('generic text batch is explicit, preserves unrelated content, replays and rejects conflicts',()=>{
 const b={frames:[],media:[],texts:[{id:'heading',text:'任意标题',x:40,y:10,width:320,height:40,fontSize:28}]};
 const old={elements:[{id:'unrelated',type:'rectangle',x:0,y:900,width:20,height:20,isDeleted:false}]};
 const out=applyCanvasBatch(JSON.stringify(old),b),v=JSON.parse(out.content);assert.equal(out.added_texts,1);assert.equal(v.elements[1].text,'任意标题');assert.equal(v.elements[1].type,'text');assert.deepEqual(v.elements[0],old.elements[0]);assert.equal(applyCanvasBatch(out.content,b).content,out.content);
 const bad=structuredClone(b);bad.texts[0].text='其他';assert.throws(()=>applyCanvasBatch(out.content,bad),{code:'IDEMPOTENCY_CONFLICT'});
 bad.texts[0].fontSize=0;assert.throws(()=>applyCanvasBatch('{}',bad),{code:'INVALID_INPUT'});
 bad.texts[0].fontSize=28;delete bad.texts[0].height;assert.throws(()=>applyCanvasBatch('{}',bad),{code:'INVALID_INPUT'});
 assert.throws(()=>applyCanvasBatch('{}',{frames:[],media:[],texts:null}),{code:'INVALID_INPUT'});
});
