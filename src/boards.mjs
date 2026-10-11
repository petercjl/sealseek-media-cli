import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {request} from './canvas.mjs';
import {authenticatedFetch} from './service.mjs';
import {META,stateRoot,hash,requireValue,createJson,readJson,replaceJob,exists,secureUrl} from './core.mjs';
import {validatePlacement} from './placement.mjs';

export function canvasId(value){requireValue(typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value),'INVALID_INPUT','Provide a valid canvas ID.');return value;}
export function canvasSummary(v){return {canvas_id:String(v.id),title:v.title,canvas_url:v.canvasUrl,updated_at:v.updateTime};}
export async function accountScope(cfg){
  const r=await authenticatedFetch(new URL('/api/user/user/info',cfg.url.origin),{headers:cfg.headers,signal:AbortSignal.timeout(30000)}),v=await r.json();
  requireValue(r.ok&&v.code===200&&v.data?.userUuid,'AUTH_REJECTED','Cannot determine the authenticated canvas account.');
  return hash({origin:cfg.url.origin,user:v.data.userUuid,company:v.data.companyUuid||''});
}
export async function getCanvas(cfg,id){const v=await request(cfg,'/canvas/detail/'+encodeURIComponent(canvasId(id)));requireValue(v?.id!==undefined&&String(v.id)===id,'CANVAS_NOT_FOUND','The selected canvas is unavailable. Select an existing canvas or explicitly create one.');return v;}
export async function createCanvas(cfg,title){requireValue(typeof title==='string'&&title.trim().length>0&&title.length<=200,'INVALID_INPUT','Provide a canvas title (1-200 characters).');const v=await request(cfg,'/canvas/create',{method:'POST',data:{title,description:'Media archive',tags:['CLI']},submission:true});requireValue(v?.id!==undefined,'SUBMISSION_UNCERTAIN','Canvas creation returned no ID. Inspect canvas list before creating again.');return v;}
export async function listCanvases(cfg,{page=1,limit=20,keyword}={}){requireValue(Number.isInteger(page)&&page>0&&Number.isInteger(limit)&&limit>=1&&limit<=100,'INVALID_INPUT','Page must be positive; limit must be 1-100.');const q=new URLSearchParams({pageNum:String(page),pageSize:String(limit),...(keyword?{keyword}:{})});const v=await request(cfg,'/canvas/list?'+q);return {canvases:(v.records||[]).map(canvasSummary),total:v.total,page:v.current,pages:v.pages};}

async function locked(key,fn){
  const p=path.join(stateRoot(),'canvases',key+'.lock');
  const end=Date.now()+30000;
  for(;;){
    try{await createJson(p,{owner:META.name,id:key,pid:process.pid});break;}catch(e){
      if(e.code!=='EEXIST')throw e;
      let old;try{old=await readJson(p);}catch(e){if(e.code==='ENOENT')continue;}
      if(old?.owner===META.name&&old.id===key&&old.pid){
        let gone=false;try{process.kill(old.pid,0);}catch(e){gone=e.code==='ESRCH';}
        if(gone){try{await fs.rename(p,p+'.'+crypto.randomUUID()+'.abandoned');}catch(e){if(e.code!=='ENOENT')throw e;}continue;}
      }
      requireValue(Date.now()<end,'CANVAS_BUSY','Another canvas operation is running or its lock needs inspection.',{lock_file:p});
      await new Promise(r=>setTimeout(r,100));
    }
  }
  try{return await fn();}finally{await fs.unlink(p);}
}
async function storePointer(p,v){
  if(await exists(p)){const old=await readJson(p);requireValue(old.owner===META.name&&old.id===v.id,'UNMANAGED_STATE','Canvas state ownership mismatch.');await createJson(p+'.'+crypto.randomUUID()+'.backup',old);await replaceJob(p,v);}else await createJson(p,v);
}
export async function useCanvas(cfg,id,session){
  const scope=hash({account:await accountScope(cfg),session:session||'default'}),v=await getCanvas(cfg,canvasId(id));
  await locked('default-'+scope,()=>storePointer(path.join(stateRoot(),'canvases',scope+'.json'),{owner:META.name,id:scope,canvas_id:id}));
  return {...canvasSummary(v),default:true};
}
export async function selectCanvas(cfg,id,session){
  const account=await accountScope(cfg),scope=hash({account,session:session||'default'});
  if(id){const v=await getCanvas(cfg,canvasId(id));return {canvas_id:id,account_scope:account,canvas_url:v.canvasUrl};}
  return locked('default-'+scope,async()=>{
    const p=path.join(stateRoot(),'canvases',scope+'.json'),old=await exists(p)?await readJson(p):null;
    if(old){requireValue(old.owner===META.name&&old.id===scope,'UNMANAGED_STATE','Canvas state ownership mismatch.');requireValue(old.canvas_id,'SUBMISSION_UNCERTAIN','A previous default canvas creation has an unresolved outcome. Inspect canvas list, then use canvas use ID --yes.');const v=await getCanvas(cfg,old.canvas_id);return {canvas_id:old.canvas_id,account_scope:account,canvas_url:v.canvasUrl};}
    // Persist intent before POST; an unknown outcome never creates another canvas automatically.
    await createJson(p,{owner:META.name,id:scope,status:'creating'});
    const v=await createCanvas(cfg,session?'SealSeek CLI · '+session.slice(0,60):'SealSeek Media CLI');
    await storePointer(p,{owner:META.name,id:scope,canvas_id:String(v.id)});
    return {canvas_id:String(v.id),account_scope:account,canvas_url:v.canvasUrl};
  });
}

export const LAYOUT={columns:5,gap:48};
function ownedMedia(e){return e.type==='image'&&e.customData?.cliTaskId;}
function bounds(e){const w=Number(e.width||0),h=Number(e.height||0),a=Number(e.angle||0),cx=Number(e.x||0)+w/2,cy=Number(e.y||0)+h/2,dx=(Math.abs(Math.cos(a))*w+Math.abs(Math.sin(a))*h)/2,dy=(Math.abs(Math.sin(a))*w+Math.abs(Math.cos(a))*h)/2;return {left:cx-dx,right:cx+dx,top:cy-dy,bottom:cy+dy};}
function bottom(e){return bounds(e).bottom;}
export function arrangeContent(content,orders={},options={}){
  const layout=validatePlacement({...options,mode:'grid'});
  const v=JSON.parse(content||'{}');requireValue(v&&typeof v==='object'&&!Array.isArray(v),'OUTPUT_CONTRACT_FAILED','Canvas content must be an object.');
  requireValue(!v.elements||Array.isArray(v.elements),'OUTPUT_CONTRACT_FAILED','Canvas elements must be an array.');v.elements||=[];
  const media=v.elements.filter(e=>!e.isDeleted&&ownedMedia(e));
  requireValue(media.every(e=>!e.frameId),'FEATURE_UNSUPPORTED','Framed media requires caller-owned placement; grid reflow cannot preserve frame membership.');
  for(const e of media){
    const order=orders[e.customData.cliTaskId];
    if(order)e.customData.cliGenerationOrder=order;
  }
  // Stable array order is the fallback for legacy media without submission metadata.
  const indexed=media.map((e,i)=>({e,i})).sort((a,b)=>{
    const ao=a.e.customData.cliGenerationOrder,bo=b.e.customData.cliGenerationOrder;
    if(ao&&bo&&ao!==bo)return ao<bo?-1:1;
    if(Boolean(ao)!==Boolean(bo))return ao?-1:1;
    if(a.e.customData.cliTaskId===b.e.customData.cliTaskId)return (a.e.customData.cliOutputIndex??a.i)-(b.e.customData.cliOutputIndex??b.i);
    return a.i-b.i;
  }).map(v=>v.e);
  const others=v.elements.filter(e=>!e.isDeleted&&!ownedMedia(e));
  let y=others.length?Math.max(0,...others.map(bottom))+layout.gap:0;
  for(let start=0;start<indexed.length;start+=layout.columns){
    const row=indexed.slice(start,start+layout.columns);let x=0,height=0;
    for(const e of row){
      requireValue(Number.isFinite(e.width)&&e.width>0&&Number.isFinite(e.height)&&e.height>0,'OUTPUT_CONTRACT_FAILED','Media dimensions must be positive.');
      if(e.x!==x||e.y!==y||e.angle!==0){e.x=x;e.y=y;e.angle=0;e.version=(e.version||0)+1;e.versionNonce=crypto.randomInt(1,2147483647);e.updated=Date.now();}
      x+=e.width+layout.gap;height=Math.max(height,e.height);
    }
    y+=height+layout.gap;
  }
  return {content:JSON.stringify(v),element_ids:indexed.map(e=>e.id),layout:{mode:layout.mode,columns:layout.columns,gap:layout.gap}};
}
export function generationParams(args={},task={}){
  const p=task.params||{},out={generatorName:'SealSeek Media CLI'};
  const fields={prompt:args.prompt,model:args.model,aspectRatio:args.aspect_ratio,resolution:args.resolution,num:args.num,duration:args.duration,generateAudio:args.generate_audio,...(args.video_options||{}),...p};
  for(const key of ['prompt','promptZh','model','modelDisplayName','aspectRatio','resolution','quality','displayName']){
    const value=task[key]??fields[key];if(typeof value==='string'&&value.trim())out[key]=value;
  }
  for(const key of ['duration','num']){const value=fields[key];if(value!=null&&value!==''&&Number.isFinite(Number(value)))out[key]=Number(value);}
  for(const key of ['generateAudio','hasAudio'])if(typeof fields[key]==='boolean')out[key]=fields[key];
  if(typeof task.billingXidou==='number')out.billingXidou=task.billingXidou;
  const mediaUrl=value=>{if(typeof value!=='string')return false;try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
  for(const [key,fallback] of [['referenceImages',args.reference_images],['referenceVideos',args.reference_videos]]){
    const values=task[key]??p[key]??fallback;if(Array.isArray(values)){const urls=values.filter(mediaUrl);if(urls.length)out[key]=urls;}
  }
  for(const [key,fallback] of [['referenceAudio',args.reference_audio],['firstFrameImage',args.first_frame_image],['lastFrameImage',args.last_frame_image]]){const value=p[key]??fallback;if(mediaUrl(value))out[key]=value;}
  return out;
}
export function appendMedia(content,{id,kind,urls,ratio='1:1',order,generationParams:params,placement={},frameId=null,posterUrl,sourceMetadata}){
  const layout=validatePlacement(placement);
  if(frameId!==null)requireValue(typeof frameId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(frameId),'INVALID_INPUT','Invalid frame ID.');
  if(posterUrl)posterUrl=secureUrl(posterUrl).href;
  if(sourceMetadata)requireValue(typeof sourceMetadata==='object'&&!Array.isArray(sourceMetadata)&&Object.keys(sourceMetadata).every(k=>['sourceUrl','productId','shopId','category','assetId'].includes(k))&&Object.values(sourceMetadata).every(v=>typeof v==='string'&&v.length<=2000),'INVALID_INPUT','Invalid source metadata.');
  if(params){requireValue(typeof params==='object'&&!Array.isArray(params),'INVALID_INPUT','Generation details must be an object.');params=generationParams({}, {...params,params});}
  requireValue(typeof id==='string'&&id.length>0&&id.length<=200&&['image','video'].includes(kind)&&Array.isArray(urls)&&urls.length>0&&urls.length<=100,'INVALID_INPUT','Provide an id, image/video kind and 1-100 URLs.');
  urls=urls.map(url=>secureUrl(url).href);
  requireValue(layout.mode!=='explicit'||layout.positions.length===urls.length,'INVALID_INPUT','Provide one position per output.');
  const v=JSON.parse(content||'{}');requireValue(v&&typeof v==='object'&&!Array.isArray(v),'OUTPUT_CONTRACT_FAILED','Canvas content must be an object.');
  requireValue(!v.elements||Array.isArray(v.elements),'OUTPUT_CONTRACT_FAILED','Canvas elements must be an array.');
  v.elements||=[];v.imageUrlMap||={};
  requireValue(typeof ratio==='string'&&/^[1-9]\d*:[1-9]\d*$/.test(ratio),'INVALID_INPUT','Ratio must be positive integers W:H.');
  const parts=ratio.split(':').map(Number),aspect=parts.length===2&&parts.every(n=>n>0)?parts[0]/parts[1]:1;
  const added=[];
  for(const [i,url] of urls.entries()){
    const elementId='cli-'+hash({id,kind,i}).slice(0,24),existing=v.elements.find(e=>e.id===elementId);
    if(existing){if(posterUrl)requireValue(existing.customData?.fileUrl===posterUrl,'IDEMPOTENCY_CONFLICT','Existing video has a different poster.');if(sourceMetadata)requireValue(JSON.stringify(existing.customData?.sourceMetadata)===JSON.stringify(sourceMetadata),'IDEMPOTENCY_CONFLICT','Existing media has different source metadata.');if(layout.mode==='explicit')requireValue(['x','y','width','height'].every(k=>layout.positions[i][k]===undefined||existing[k]===layout.positions[i][k]),'IDEMPOTENCY_CONFLICT','Existing media has different placement.');requireValue(existing.frameId===frameId,'IDEMPOTENCY_CONFLICT','Existing media has a different frame.');requireValue((kind==='video'?existing.customData?.videoUrl:existing.customData?.fileUrl)===url,'IDEMPOTENCY_CONFLICT','This media id is already associated with different content.');if(!existing.isDeleted&&params){const previous=existing.customData?.generationParams;const merged={...previous,...params};if(JSON.stringify(previous)!==JSON.stringify(merged)){existing.customData={...existing.customData,generationParams:merged};existing.version=(existing.version||1)+1;existing.updated=Date.now();}}continue;}
    const fileId='file-'+elementId,thumbnail=kind==='video'?(posterUrl||url+(url.includes('?')?'&':'?')+'x-oss-process=video/snapshot,t_0,w_1920,f_jpg,m_fast'):url;
    const pos=layout.mode==='explicit'?layout.positions[i]:{},width=pos.width??layout.width,height=pos.height??layout.height??Math.max(1,Math.round(width/aspect));
    requireValue(Number.isFinite(height)&&height>0&&height<=100000,'INVALID_INPUT','Derived height exceeds placement limits; provide explicit dimensions.');
    const element={type:'image',id:elementId,x:pos.x??0,y:pos.y??0,width,height,fileId,scale:[1,1],isDeleted:false,locked:false,opacity:100,angle:0,strokeColor:'transparent',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:0,strokeStyle:'solid',roughness:0,roundness:null,seed:1,version:1,versionNonce:1,link:null,groupIds:[],frameId,boundElements:[],updated:Date.now(),status:'saved',strokeSharpness:'sharp',customData:{fileUrl:thumbnail,fileMimeType:kind==='video'?'image/jpeg':({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[path.extname(new URL(url).pathname).toLowerCase()]||'image/png'),...(kind==='video'?{isVideoThumbnail:true,videoUrl:url,displayName:'CLI video'}:{}),cliTaskId:id,cliOutputIndex:i,...(sourceMetadata?{sourceMetadata:structuredClone(sourceMetadata)}:{}),...(order?{cliGenerationOrder:order}:{})}};
    if(params)element.customData.generationParams=structuredClone(params);
    if(layout.mode==='append'){
      const active=v.elements.filter(e=>!e.isDeleted),media=active.filter(ownedMedia),last=media.at(-1);
      const count=last?.customData?.cliAppendSlot;
      const slot=Number.isInteger(count)?count+1:layout.columns;
      const row=last?media.filter(e=>e.y===last.y):[];
      let x=last&&slot<layout.columns?Math.max(...row.map(e=>bounds(e).right))+layout.gap:0;
      let y=last&&slot<layout.columns?last.y:(active.length?Math.max(0,...active.map(bottom))+layout.gap:0);
      // Append never changes existing elements. Fall below occupied bounds on collision.
      if(active.some(e=>{const b=bounds(e);return x<b.right&&x+width>b.left&&y<b.bottom&&y+height>b.top;})){
        x=0;y=Math.max(0,...active.map(bottom))+layout.gap;
      }
      element.x=x;element.y=y;element.customData.cliAppendSlot=x===0?0:slot;
    }
    v.elements.push(element);v.imageUrlMap[fileId]=thumbnail;added.push(elementId);
  }
  return layout.mode==='grid'?{...arrangeContent(JSON.stringify(v),order?{[id]:order}:{},layout),added}:{content:JSON.stringify(v),added,layout};
}
async function saveContent(cfg,board,before,next){
  const backup=path.join(stateRoot(),'canvases','backups',board+'-'+crypto.randomUUID()+'.json');
  await createJson(backup,{owner:META.name,id:board,content:before.content||'{}',created_at:new Date().toISOString()});
  const fresh=await getCanvas(cfg,board);requireValue((fresh.content||'{}')===(before.content||'{}'),'CANVAS_CHANGED','Canvas changed during archival. Retry after manual editing ends.');
  await request(cfg,'/canvas/save',{method:'POST',data:{id:board,content:next.content,triggerType:'auto',...((before.thumbnail||JSON.parse(next.content).elements.find(e=>!e.isDeleted&&ownedMedia(e))?.customData?.fileUrl)?{thumbnail:before.thumbnail||JSON.parse(next.content).elements.find(e=>!e.isDeleted&&ownedMedia(e)).customData.fileUrl}:{})},submission:true});
  const after=await getCanvas(cfg,board),elements=JSON.parse(after.content||'{}').elements||[],expected=JSON.parse(next.content).elements||[];
  requireValue(expected.every(e=>{const found=elements.find(a=>a.id===e.id);return found&&found.x===e.x&&found.y===e.y&&found.width===e.width&&found.height===e.height&&found.isDeleted===e.isDeleted&&found.type===e.type&&found.frameId===e.frameId&&found.name===e.name&&['text','originalText','fontSize','fontFamily','textAlign','lineHeight'].every(k=>found[k]===e[k])&&JSON.stringify(found.customData)===JSON.stringify(e.customData)&&(!e.customData?.generationParams||JSON.stringify(found.customData?.generationParams)===JSON.stringify(e.customData.generationParams));}),'CANVAS_SAVE_UNCERTAIN','Canvas positions and generation details could not be verified. Inspect the canvas before retrying; do not regenerate.');
  return {saved:true,canvas_url:after.canvasUrl,backup};
}
export async function archiveMedia(cfg,board,media){
  canvasId(board);
  return locked('save-'+hash({origin:cfg.url.origin,board}),async()=>{
    const before=await getCanvas(cfg,board),next=appendMedia(before.content,media);
    if(next.content===JSON.stringify(JSON.parse(before.content||'{}')))return {saved:true,added:0,canvas_url:before.canvasUrl};
    return {...await saveContent(cfg,board,before,next),added:next.added.length,layout:next.layout};
  });
}
export async function arrangeCanvas(cfg,board,placement={}){
  canvasId(board);
  return locked('save-'+hash({origin:cfg.url.origin,board}),async()=>{
    const before=await getCanvas(cfg,board),orders={};
    for(const file of await fs.readdir(path.join(stateRoot(),'jobs')).catch(()=>[])){
      if(!file.endsWith('.json'))continue;const job=await readJson(path.join(stateRoot(),'jobs',file)).catch(()=>null);
      if(job?.owner===META.name&&job.remote?.canvasId===board&&job.remote.remote_task_id&&job.created_at)orders[job.remote.remote_task_id]=job.created_at;
    }
    const next=arrangeContent(before.content,orders,placement);
    if(next.content===JSON.stringify(JSON.parse(before.content||'{}')))return {saved:true,changed:false,element_count:next.element_ids.length,layout:next.layout,canvas_url:before.canvasUrl};
    return {...await saveContent(cfg,board,before,next),changed:true,element_count:next.element_ids.length,layout:next.layout};
  });
}

export function applyCanvasBatch(content,batch){
  requireValue(batch&&typeof batch==='object'&&Object.keys(batch).every(k=>['frames','media','texts'].includes(k))&&Array.isArray(batch.frames)&&Array.isArray(batch.media)&&batch.frames.length<=100&&batch.media.length<=500&&(batch.texts===undefined||(Array.isArray(batch.texts)&&batch.texts.length<=100)),'INVALID_INPUT','Batch requires frames (0-100) and media (0-500).');
  const v=JSON.parse(content||'{}');v.elements||=[];let addedFrames=0;
  const ids=new Set();
  for(const f of batch.frames){
    requireValue(f&&Object.keys(f).every(k=>['id','name','x','y','width','height'].includes(k))&&/^[A-Za-z0-9_-]{1,100}$/.test(f.id)&&!ids.has(f.id)&&typeof f.name==='string'&&f.name.trim()&&f.name.length<=200,'INVALID_INPUT','Invalid or duplicate frame.');ids.add(f.id);
    validatePlacement({mode:'explicit',positions:[{x:f.x,y:f.y,width:f.width,height:f.height}]});
    const e={type:'frame',...f,angle:0,strokeColor:'#bbb',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:Date.now(),link:null,locked:false};
    const old=v.elements.find(e=>e.id===f.id);
    if(old)requireValue(!old.isDeleted&&old.type==='frame'&&['name','x','y','width','height'].every(k=>old[k]===f[k]),'IDEMPOTENCY_CONFLICT','Frame ID already has different bounds or content.');
    else{v.elements.push(e);addedFrames++;}
  }
  let addedTexts=0;
  for(const t of batch.texts||[]){
    requireValue(t&&Object.keys(t).every(k=>['id','text','x','y','width','height','fontSize'].includes(k))&&/^[A-Za-z0-9_-]{1,100}$/.test(t.id)&&!ids.has(t.id)&&typeof t.text==='string'&&t.text.trim()&&t.text.length<=1000&&Number.isFinite(t.fontSize)&&t.fontSize>=8&&t.fontSize<=200,'INVALID_INPUT','Invalid or duplicate text element.');ids.add(t.id);
    requireValue(['x','y','width','height'].every(k=>Number.isFinite(t[k])),'INVALID_INPUT','Text bounds must be explicit.');
    validatePlacement({mode:'explicit',positions:[{x:t.x,y:t.y,width:t.width,height:t.height}]});
    const e={type:'text',...t,originalText:t.text,fontFamily:2,textAlign:'left',verticalAlign:'top',lineHeight:1.25,autoResize:false,containerId:null,angle:0,strokeColor:'#222222',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:Date.now(),link:null,locked:false};
    const old=v.elements.find(e=>e.id===t.id);
    if(old)requireValue(!old.isDeleted&&old.type==='text'&&['text','x','y','width','height','fontSize'].every(k=>old[k]===t[k]),'IDEMPOTENCY_CONFLICT','Text ID already has different bounds or content.');
    else{v.elements.push(e);addedTexts++;}
  }
  let next=JSON.stringify(v),added=0;
  for(const m of batch.media){
    requireValue(m&&Object.keys(m).every(k=>['id','kind','urls','ratio','placement','generationParams','frameId','posterUrl','sourceMetadata'].includes(k)),'INVALID_INPUT','Unknown media field.');
    const frame=m.frameId?v.elements.find(e=>e.id===m.frameId&&e.type==='frame'&&!e.isDeleted):null;
    requireValue(!m.frameId||frame,'INVALID_INPUT','Media frame does not exist.');
    requireValue(m.placement?.mode==='explicit','INVALID_INPUT','Batch media requires explicit placement.');
    if(frame)for(const p of m.placement.positions||[])requireValue(p.x>=frame.x&&p.y>=frame.y&&p.x+p.width<=frame.x+frame.width&&p.y+p.height<=frame.y+frame.height,'INVALID_INPUT','Media bounds exceed its frame.');
    const out=appendMedia(next,m);next=out.content;added+=out.added.length;
  }
  return {content:next,added_frames:addedFrames,added_media:added,added_texts:addedTexts};
}
export async function batchCanvas(cfg,board,batch){
  canvasId(board);return locked('save-'+hash({origin:cfg.url.origin,board}),async()=>{
    const before=await getCanvas(cfg,board),next=applyCanvasBatch(before.content,batch);
    if(!next.added_frames&&!next.added_media&&!next.added_texts)return {saved:true,changed:false,canvas_url:before.canvasUrl,added_frames:0,added_media:0,added_texts:0};
    return {...await saveContent(cfg,board,before,next),added_frames:next.added_frames,added_media:next.added_media,added_texts:next.added_texts};
  });
}

export function placeElements(content,placements){
  requireValue(Array.isArray(placements)&&placements.length>0&&placements.length<=1000,'INVALID_INPUT','Provide 1-1000 element placements.');
  const v=JSON.parse(content||'{}'),ids=new Set();let changed=0;
  for(const p of placements){
    requireValue(p&&Object.keys(p).every(k=>['id','x','y','width','height','expected'].includes(k))&&typeof p.id==='string'&&!ids.has(p.id),'INVALID_INPUT','Invalid or duplicate element placement.');ids.add(p.id);
    const position={x:p.x,y:p.y,width:p.width,height:p.height};validatePlacement({mode:'explicit',positions:[position]});
    const e=v.elements?.find(e=>e.id===p.id&&!e.isDeleted);requireValue(e,'ELEMENT_NOT_FOUND','Selected element is unavailable.');
    const same=['x','y','width','height'].every(k=>e[k]===p[k]);if(same)continue;
    if(p.expected)requireValue(['x','y','width','height'].every(k=>e[k]===p.expected[k]),'CANVAS_CHANGED','Selected element changed since planning.');
    Object.assign(e,position,{version:(e.version||1)+1,versionNonce:crypto.randomInt(1,2147483647),updated:Date.now()});changed++;
  }
  for(const e of v.elements||[]){if(e.isDeleted||!e.frameId)continue;const f=v.elements.find(f=>f.id===e.frameId&&!f.isDeleted&&f.type==='frame');requireValue(f&&e.x>=f.x-1e-6&&e.y>=f.y-1e-6&&e.x+e.width<=f.x+f.width+1e-6&&e.y+e.height<=f.y+f.height+1e-6,'INVALID_INPUT','Placement leaves a member outside its Frame.');}
  return {content:JSON.stringify(v),changed};
}
export async function placeCanvas(cfg,board,placements,submit=false){
  canvasId(board);return locked('save-'+hash({origin:cfg.url.origin,board}),async()=>{
    const before=await getCanvas(cfg,board),next=placeElements(before.content,placements);
    if(!submit)return {dry_run:true,changed_elements:next.changed};
    if(!next.changed)return {saved:true,changed_elements:0,canvas_url:before.canvasUrl};
    return {...await saveContent(cfg,board,before,next),changed_elements:next.changed};
  });
}

async function exactTitleCanvases(cfg,title){
  const items=new Map();let page=1;
  for(;;){
    const result=await listCanvases(cfg,{page,limit:100,keyword:title});
    for(const v of result.canvases)if(v.title===title)items.set(v.canvas_id,v);
    if(page>=Number(result.pages||1))break;page++;
  }
  return [...items.values()];
}
export async function deleteCanvases(cfg,{id,title,submit=false,yes=false}={}){
  requireValue(Boolean(id)!==Boolean(title),'INVALID_INPUT','Select one canvas ID or an exact title.');
  if(title)requireValue(typeof title==='string'&&title.trim().length>0,'INVALID_INPUT','Provide an exact nonempty title.');
  const scope=await accountScope(cfg);
  return locked('delete-'+scope,async()=>{
    const selected=id?[canvasSummary(await getCanvas(cfg,canvasId(id)))]:await exactTitleCanvases(cfg,title);
    if(!submit)return {dry_run:true,paid_action:false,count:selected.length,canvases:selected};
    requireValue(yes,'CONFIRMATION_REQUIRED','Canvas deletion requires --submit --yes after explicit human authorization.');
    if(!selected.length)return {deleted:0,remaining:0};
    const backup=path.join(stateRoot(),'canvases','deletion-backups',crypto.randomUUID());
    // Complete and verify all backups before deleting the first canvas.
    for(const v of selected){
      const board=await getCanvas(cfg,v.canvas_id);requireValue(board.title===v.title,'CANVAS_CHANGED','A selected canvas title changed. Deletion stopped.');
      const tasks=await request(cfg,'/canvas/tasks?'+new URLSearchParams({canvasId:v.canvas_id}));
      const p=path.join(backup,v.canvas_id+'.json');
      await createJson(p,{owner:META.name,id:v.canvas_id,canvas:board,tasks,account_scope:scope,created_at:new Date().toISOString()});
      const saved=await readJson(p);requireValue(hash(saved.canvas)===hash(board)&&hash(saved.tasks)===hash(tasks),'BACKUP_VERIFICATION_FAILED','Canvas backup verification failed.');
    }
    const deleted=[];
    for(const v of selected){
      const fresh=await getCanvas(cfg,v.canvas_id);requireValue(fresh.title===v.title,'CANVAS_CHANGED','A selected canvas title changed. Deletion stopped.',{backup,deleted});
      try{
        const result=await request(cfg,'/canvas/delete/'+encodeURIComponent(v.canvas_id),{method:'DELETE',submission:true});
        requireValue(result===true,'CANVAS_DELETE_UNCERTAIN','Canvas deletion returned no verified success. Inspect canvas list before retrying.');
        deleted.push(v.canvas_id);
        await createJson(path.join(backup,v.canvas_id+'.deleted.json'),{owner:META.name,id:v.canvas_id,status:'deleted',deleted_at:new Date().toISOString()});
      }catch(e){e.details={...e.details,backup,deleted,unresolved_canvas_id:v.canvas_id,retry_automatically:false};throw e;}
    }
    const remaining=title?(await exactTitleCanvases(cfg,title)).length:null;
    requireValue(remaining===null||remaining===0,'CANVAS_DELETE_UNCERTAIN','Matching canvases remain. Inspect history before any further deletion.',{backup,deleted,remaining});
    return {deleted:deleted.length,deleted_canvas_ids:deleted,remaining,backup};
  });
}
