import crypto from 'node:crypto';
import path from 'node:path';
import {request} from './canvas.mjs';
import {accountScope,locked} from './boards.mjs';
import {folderId,listFolders} from './canvas-files.mjs';
import {META,stateRoot,hash,requireValue,createJson,readJson,exists,replaceJob} from './core.mjs';

function projectName(name){
  requireValue(typeof name==='string'&&name.trim().length>0&&name.length<=20,'INVALID_INPUT','Provide a project name (1-20 characters).');
  return name;
}
async function findProject(cfg,id){
  const project=(await listFolders(cfg)).folders.find(f=>f.folder_id===id);
  requireValue(project,'FOLDER_NOT_FOUND','The project is unavailable. Inspect project list before continuing.',{folder_id:id});
  return project;
}
export async function createProject(cfg,{name,requestId,submit=false}={}){
  projectName(name);
  requireValue(typeof requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(requestId),'INVALID_INPUT','Provide a stable --request-id (1-100 letters, numbers, underscores or hyphens). Reuse it for this creation.');
  const result={operation:'project-create',target:{name},request_id:requestId,dry_run:!submit};
  if(!submit)return result;
  const account=await accountScope(cfg),id=hash({account,requestId});
  return locked('project-create-'+id,async()=>{
    const file=path.join(stateRoot(),'projects','requests',id+'.json');
    const old=await exists(file)?await readJson(file):null;
    if(old){
      requireValue(old.owner===META.name&&old.id===id,'UNMANAGED_STATE','Project request ownership mismatch.');
      requireValue(old.name===name,'IDEMPOTENCY_CONFLICT','This request ID belongs to another project name.');
      requireValue(old.folder_id,'SUBMISSION_UNCERTAIN','A previous creation has an unresolved outcome. Inspect project list; do not repeat with a new request ID.',{request_id:requestId,record:file,retry_automatically:false});
      const project=await findProject(cfg,old.folder_id);
      return {...result,changed:false,deduplicated:true,verified:true,project,record:file};
    }
    const intent={owner:META.name,id,name,request_id:requestId,status:'creating'};
    await createJson(file,intent);
    try{
      const created=await request(cfg,'/canvas/folder/create',{method:'POST',data:{folderName:name},submission:true});
      requireValue(Number.isInteger(created)&&created>0&&created<=2147483647,'SUBMISSION_UNCERTAIN','Project creation returned no valid ID. Inspect project list before another creation.');
      // Persist the remote ID before readback; recovery never repeats POST.
      await replaceJob(file,{...intent,folder_id:String(created),status:'created'});
      const project=await findProject(cfg,String(created));
      requireValue(project.name===name,'PROJECT_UPDATE_UNCERTAIN','Created project name could not be verified. Inspect project list.');
      return {...result,changed:true,verified:true,project,record:file};
    }catch(e){e.details={...e.details,request_id:requestId,record:file,retry_automatically:false};throw e;}
  });
}
export async function renameProject(cfg,id,{name,submit=false}={}){
  id=String(folderId(id));projectName(name);
  const account=await accountScope(cfg);
  return locked('project-rename-'+hash({account,id}),async()=>{
    const before=await findProject(cfg,id);
    const result={operation:'project-rename',before,target:{name},dry_run:!submit};
    if(!submit)return result;
    if(before.name===name)return {...result,changed:false,verified:true,project:before};
    const backup=path.join(stateRoot(),'projects','metadata-backups',crypto.randomUUID()+'.json');
    const snapshot={owner:META.name,operation:result.operation,project:before,target:{name}};
    await createJson(backup,snapshot);
    requireValue(hash(await readJson(backup))===hash(snapshot),'BACKUP_VERIFICATION_FAILED','Project backup could not be verified.');
    try{
      await request(cfg,'/canvas/folder/update',{method:'POST',data:{id:Number(id),folderName:name},submission:true});
      const project=await findProject(cfg,id);
      requireValue(project.name===name,'PROJECT_UPDATE_UNCERTAIN','Project rename could not be verified. Inspect the same project before retrying.');
      return {...result,changed:true,verified:true,project,backup};
    }catch(e){e.details={...e.details,folder_id:id,backup,retry_automatically:false};throw e;}
  });
}
