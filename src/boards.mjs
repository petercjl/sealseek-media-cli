import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {request} from './canvas.mjs';
import {authenticatedFetch} from './service.mjs';
import {META,stateRoot,hash,requireValue,createJson,readJson,replaceJob,exists} from './core.mjs';

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
function bottom(e){const w=Number(e.width||0),h=Number(e.height||0),a=Number(e.angle||0);return Number(e.y||0)+h/2+(Math.abs(Math.sin(a))*w+Math.abs(Math.cos(a))*h)/2;}
export function arrangeContent(content,orders={}){
  const v=JSON.parse(content||'{}');requireValue(v&&typeof v==='object'&&!Array.isArray(v),'OUTPUT_CONTRACT_FAILED','Canvas content must be an object.');
  requireValue(!v.elements||Array.isArray(v.elements),'OUTPUT_CONTRACT_FAILED','Canvas elements must be an array.');v.elements||=[];
  const media=v.elements.filter(e=>!e.isDeleted&&ownedMedia(e));
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
  let y=others.length?Math.max(0,...others.map(bottom))+LAYOUT.gap:0;
  for(let start=0;start<indexed.length;start+=LAYOUT.columns){
    const row=indexed.slice(start,start+LAYOUT.columns);let x=0,height=0;
    for(const e of row){
      requireValue(Number.isFinite(e.width)&&e.width>0&&Number.isFinite(e.height)&&e.height>0,'OUTPUT_CONTRACT_FAILED','Media dimensions must be positive.');
      if(e.x!==x||e.y!==y||e.angle!==0){e.x=x;e.y=y;e.angle=0;e.version=(e.version||0)+1;e.versionNonce=crypto.randomInt(1,2147483647);e.updated=Date.now();}
      x+=e.width+LAYOUT.gap;height=Math.max(height,e.height);
    }
    y+=height+LAYOUT.gap;
  }
  return {content:JSON.stringify(v),element_ids:indexed.map(e=>e.id),layout:LAYOUT};
}
export function appendMedia(content,{id,kind,urls,ratio='1:1',order}){
  const v=JSON.parse(content||'{}');requireValue(v&&typeof v==='object'&&!Array.isArray(v),'OUTPUT_CONTRACT_FAILED','Canvas content must be an object.');
  requireValue(!v.elements||Array.isArray(v.elements),'OUTPUT_CONTRACT_FAILED','Canvas elements must be an array.');
  v.elements||=[];v.imageUrlMap||={};
  const parts=ratio.split(':').map(Number),aspect=parts.length===2&&parts.every(n=>n>0)?parts[0]/parts[1]:1;
  const added=[];
  for(const [i,url] of urls.entries()){
    const elementId='cli-'+hash({id,kind,i}).slice(0,24);if(v.elements.some(e=>e.id===elementId))continue;
    const fileId='file-'+elementId,thumbnail=kind==='video'?url+(url.includes('?')?'&':'?')+'x-oss-process=video/snapshot,t_0,w_1920,f_jpg,m_fast':url;
    const element={type:'image',id:elementId,x:0,y:0,width:320,height:Math.round(320/aspect),fileId,scale:[1,1],isDeleted:false,locked:false,opacity:100,angle:0,strokeColor:'transparent',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:0,strokeStyle:'solid',roughness:0,roundness:null,seed:1,version:1,versionNonce:1,link:null,groupIds:[],frameId:null,boundElements:[],updated:Date.now(),status:'saved',strokeSharpness:'sharp',customData:{fileUrl:thumbnail,fileMimeType:kind==='video'?'image/jpeg':'image/png',...(kind==='video'?{isVideoThumbnail:true,videoUrl:url,displayName:'CLI video'}:{}),cliTaskId:id,cliOutputIndex:i,...(order?{cliGenerationOrder:order}:{})}};
    v.elements.push(element);v.imageUrlMap[fileId]=thumbnail;added.push(elementId);
  }
  return {...arrangeContent(JSON.stringify(v),order?{[id]:order}:{}),added};
}
async function saveContent(cfg,board,before,next){
  const backup=path.join(stateRoot(),'canvases','backups',board+'-'+crypto.randomUUID()+'.json');
  await createJson(backup,{owner:META.name,id:board,content:before.content||'{}',created_at:new Date().toISOString()});
  const fresh=await getCanvas(cfg,board);requireValue((fresh.content||'{}')===(before.content||'{}'),'CANVAS_CHANGED','Canvas changed during archival. Retry after manual editing ends.');
  await request(cfg,'/canvas/save',{method:'POST',data:{id:board,content:next.content,triggerType:'auto',...((before.thumbnail||JSON.parse(next.content).elements.find(e=>!e.isDeleted&&ownedMedia(e))?.customData?.fileUrl)?{thumbnail:before.thumbnail||JSON.parse(next.content).elements.find(e=>!e.isDeleted&&ownedMedia(e)).customData.fileUrl}:{})},submission:true});
  const after=await getCanvas(cfg,board),elements=JSON.parse(after.content||'{}').elements||[],expected=JSON.parse(next.content).elements||[];
  requireValue(expected.every(e=>{const found=elements.find(a=>a.id===e.id);return found&&found.x===e.x&&found.y===e.y&&found.width===e.width&&found.height===e.height&&found.isDeleted===e.isDeleted;}),'CANVAS_SAVE_UNCERTAIN','Canvas positions could not be verified. Inspect the canvas before retrying; do not regenerate.');
  return {saved:true,canvas_url:after.canvasUrl,backup};
}
export async function archiveMedia(cfg,board,media){
  canvasId(board);
  return locked('save-'+hash({origin:cfg.url.origin,board}),async()=>{
    const before=await getCanvas(cfg,board),next=appendMedia(before.content,media);
    if(next.content===JSON.stringify(JSON.parse(before.content||'{}')))return {saved:true,added:0,canvas_url:before.canvasUrl};
    return {...await saveContent(cfg,board,before,next),added:next.added.length,layout:LAYOUT};
  });
}
export async function arrangeCanvas(cfg,board){
  canvasId(board);
  return locked('save-'+hash({origin:cfg.url.origin,board}),async()=>{
    const before=await getCanvas(cfg,board),orders={};
    for(const file of await fs.readdir(path.join(stateRoot(),'jobs')).catch(()=>[])){
      if(!file.endsWith('.json'))continue;const job=await readJson(path.join(stateRoot(),'jobs',file)).catch(()=>null);
      if(job?.owner===META.name&&job.remote?.canvasId===board&&job.remote.remote_task_id&&job.created_at)orders[job.remote.remote_task_id]=job.created_at;
    }
    const next=arrangeContent(before.content,orders);
    if(next.content===JSON.stringify(JSON.parse(before.content||'{}')))return {saved:true,changed:false,element_count:next.element_ids.length,layout:LAYOUT,canvas_url:before.canvasUrl};
    return {...await saveContent(cfg,board,before,next),changed:true,element_count:next.element_ids.length,layout:LAYOUT};
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
