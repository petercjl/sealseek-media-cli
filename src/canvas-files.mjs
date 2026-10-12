import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import {request} from './canvas.mjs';
import {canvasId,canvasSummary,getCanvas,locked} from './boards.mjs';
import {META,stateRoot,hash,requireValue,createJson,readJson} from './core.mjs';

export function folderId(value){
  requireValue(typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number(value)<=2147483647,'INVALID_INPUT','Provide a positive folder ID from canvas folders.');
  return Number(value);
}
export async function listFolders(cfg,{keyword}={}){
  const data=await request(cfg,'/canvas/folder/list');
  requireValue(Array.isArray(data)&&data.every(f=>Number.isInteger(f.id)&&f.id>0&&typeof f.folderName==='string'),'OUTPUT_CONTRACT_FAILED','The folder list is malformed.');
  const folders=data.filter(f=>!keyword||f.folderName.includes(keyword)).map(f=>({folder_id:String(f.id),name:f.folderName,canvas_count:f.canvasCount}));
  return {folders,count:folders.length,complete:true,projects_are_folders:true};
}
export async function changeCanvasFile(cfg,id,{title,folder,root=false,submit=false}={}){
  canvasId(id);
  const rename=title!==undefined;
  requireValue(rename?folder===undefined&&!root:(folder!==undefined)!==root,'INVALID_INPUT','Specify a title, one folder ID, or root.');
  if(rename)requireValue(typeof title==='string'&&title.trim().length>0&&title.length<=200,'INVALID_INPUT','Provide a canvas title (1-200 characters).');
  const destination=rename?undefined:root?null:folderId(folder);
  return locked('save-'+hash({origin:cfg.url.origin,board:id}),async()=>{
    const before=await getCanvas(cfg,id);
    if(!rename)requireValue(Object.hasOwn(before,'folderId'),'OUTPUT_CONTRACT_FAILED','Canvas detail omits folder ownership; no move performed.');
    const target=destination===null||rename?null:(await listFolders(cfg)).folders.find(f=>f.folder_id===String(destination));
    requireValue(rename||destination===null||target,'FOLDER_NOT_FOUND','Select an existing project/folder from canvas folders.');
    const desired=rename?{title}:{folder_id:destination===null?null:String(destination),folder_name:target?.name||null};
    const result={operation:rename?'rename':'move',before:canvasSummary(before),target:desired,dry_run:!submit};
    if(!submit)return result;
    if(rename?before.title===title:before.folderId===destination)return {...result,changed:false,verified:true,canvas:canvasSummary(before)};
    const backup=path.join(stateRoot(),'canvases','metadata-backups',crypto.randomUUID()+'.json');
    const snapshot={owner:META.name,operation:result.operation,canvas:before,target:desired};
    await createJson(backup,snapshot);
    requireValue(hash(await readJson(backup))===hash(snapshot)&&(await fs.stat(backup)).size>0,'BACKUP_VERIFICATION_FAILED','Canvas metadata backup could not be verified.');
    try{
      if(rename)await request(cfg,'/canvas/update',{method:'PUT',data:{id,title},submission:true});
      else await request(cfg,(root?'/canvas/folder/unbind?':'/canvas/folder/bind?')+new URLSearchParams({canvasId:id,...(root?{}:{folderId:String(destination)})}),{submission:true});
      const after=await getCanvas(cfg,id);
      const applied=rename?after.title===title&&(!Object.hasOwn(before,'folderId')||after.folderId===before.folderId):Object.hasOwn(after,'folderId')&&after.folderId===destination&&after.title===before.title;
      requireValue(applied&&after.content===before.content,'CANVAS_UPDATE_UNCERTAIN','Canvas name, ownership or content could not be verified. Inspect the same canvas before retrying.',{canvas_id:id,retry_automatically:false});
      return {...result,changed:true,verified:true,backup,canvas:canvasSummary(after)};
    }catch(e){e.details={...e.details,canvas_id:id,backup,retry_automatically:false};throw e;}
  });
}
