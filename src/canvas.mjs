import crypto from 'node:crypto';
import {assertModelAllowed,filterModels} from './model-policy.mjs';
import fs from 'node:fs/promises';
import Ajv from 'ajv';
import { MediaError,requireValue } from './core.mjs';
import { desktopConfig,authenticatedFetch,sanitizeProviderText } from './service.mjs';
import { liveCatalog } from './models.mjs';
export { desktopConfig,authenticatedFetch,sanitizeProviderText } from './service.mjs';

export const API='/api/sealseek-infinitecanvas';
export const NATIVE_CONTRACT=JSON.parse(await fs.readFile(new URL('./native-contract.json',import.meta.url),'utf8'));
export async function request(cfg,route,{method='GET',data,timeout=30000,submission=false}={}) {
  let response,body;
  try {
    response=await authenticatedFetch(new URL(API+route,cfg.url.origin),{method,headers:{...cfg.headers,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),redirect:'error',signal:AbortSignal.timeout(timeout)});
    body=await response.json();
  } catch(e) {
    if(e instanceof MediaError)throw e;
    throw new MediaError(submission?'SUBMISSION_UNCERTAIN':'CONNECTION_FAILED','Infinite Canvas request ended without a verified response.',{transport_error:sanitizeProviderText(e.message||''),retry_automatically:false});
  }
  requireValue(response.ok&&body.code===200,'PROVIDER_FAILURE','Infinite Canvas rejected the request.',{provider_text:sanitizeProviderText(body.msg||body.message||''),provider_code:body.code,retry_automatically:false});
  return body.data;
}
export function toolsFor(catalog) {
  const text={type:'string'},urls={type:'array',items:text};
  return ['image','video'].map(kind=>({name:`generate_${kind}`,transport:'SealSeek Infinite Canvas REST',inputSchema:{type:'object',required:['prompt','model'],properties:{prompt:text,model:{type:'string',enum:filterModels(catalog.models).filter(m=>m.type===kind).map(m=>m.id)},aspect_ratio:text,resolution:text,...(kind==='image'?{num:{type:'integer',minimum:1,maximum:4}}:{duration:{type:'integer',minimum:1},first_frame_image:text,last_frame_image:text,reference_videos:urls,reference_audio:text,generate_audio:{type:'boolean'},video_options:{type:'object'}}),reference_images:urls}}}));
}
export async function connect(options={}) {
  const cfg=await desktopConfig(options),catalog=await liveCatalog(options,cfg);
  return {cfg,catalog,tools:toolsFor(catalog),close:async()=>{}};
}
export function toolFor(tools,name){const tool=tools.find(t=>t.name===name);requireValue(tool,'CAPABILITY_UNAVAILABLE',`Infinite Canvas operation ${name} is unavailable.`);return tool;}
export function validateArguments(tool,args){const validate=new Ajv({strict:false,allErrors:true}).compile({...tool.inputSchema,additionalProperties:false});requireValue(validate(args),'FEATURE_UNSUPPORTED','The request does not match the Infinite Canvas contract.',{fields:validate.errors});}
export function validateNativeInput(schemaName,input) {
  const schema=NATIVE_CONTRACT.schemas[schemaName];
  requireValue(schema,'CAPABILITY_UNAVAILABLE','Native operation schema is unavailable.');
  const validate=new Ajv({strict:false,allErrors:true,formats:{int32:true,int64:true,double:true,float:true}}).compile({...schema,additionalProperties:false,components:{schemas:NATIVE_CONTRACT.schemas}});
  requireValue(validate(JSON.parse(JSON.stringify(input))),'FEATURE_UNSUPPORTED','The request does not match the official Infinite Canvas schema.',{schema:schemaName,fields:validate.errors});
  return input;
}
export function generationPayload(kind,args,{canvasId,traceId}) {
  const refs=args.reference_images||[];
  const payload={canvasId,traceId,mode:kind,chatMode:'agent',prompt:args.prompt,message:args.prompt,model:args.model,aspectRatio:args.aspect_ratio,resolution:args.resolution,...(refs.length?{images:refs}:{})};
  if(kind==='image'){payload.num=args.num||1;payload.imageParams={model:args.model,num:String(payload.num),resolution:args.resolution,aspectRatio:args.aspect_ratio,...(refs.length?{images:refs}:{})};}
  else {
    payload.duration=args.duration;payload.firstFrameImage=args.first_frame_image;payload.lastFrameImage=args.last_frame_image;
    payload.videoParams={...(args.video_options||{}),model:args.model,duration:String(args.duration),aspectRatio:args.aspect_ratio,resolution:args.resolution,...(refs.length?{referenceImages:refs}:{}),...(args.reference_videos?.length?{referenceVideos:args.reference_videos}:{}),...(args.reference_audio?{referenceAudio:args.reference_audio}:{}),...(args.generate_audio!==undefined?{generateAudio:args.generate_audio}:{})};
    payload.bgm=args.generate_audio===true;payload.cameraFixed=false;
  }
  validateNativeInput(kind==='image'?'ImageParams':'VideoParams',kind==='image'?payload.imageParams:payload.videoParams);
  return payload;
}
export function taskId(data){const value=typeof data==='string'||typeof data==='number'?data:data?.taskId??data?.id;requireValue(value!==undefined&&value!==null&&String(value).length>0,'SUBMISSION_UNCERTAIN','Infinite Canvas returned no task ID. Inspect history before any new submission.');return String(value);}
export async function pollTask(cfg,id,{timeout=900000,interval=5000,onProgress}={}) {
  const end=Date.now()+timeout;let lastError;
  while(Date.now()<end){
    let data;
    try{data=await request(cfg,'/canvas/tasks/'+encodeURIComponent(id),{timeout:Math.max(1,Math.min(20000,end-Date.now()))});}
    catch(e){if(e.code==='AUTH_REJECTED')throw e;lastError=e;await new Promise(r=>setTimeout(r,Math.min(interval,Math.max(0,end-Date.now()))));continue;}
    const status=String(data?.status||'').toLowerCase();
    if(['done','success','succeeded'].includes(status))return data;
    requireValue(!['failed','not_found','cancelled','canceled'].includes(status),'PROVIDER_FAILURE','Infinite Canvas task failed.',{provider_text:sanitizeProviderText(data.errorMessage||status),provider_code:data.errorCode,remote_task_id:id,retry_automatically:false});
    await onProgress?.(data);await new Promise(r=>setTimeout(r,Math.min(interval,Math.max(0,end-Date.now()))));
  }
  throw new MediaError('SUBMISSION_UNCERTAIN','The saved Infinite Canvas task is still unresolved. Resume this task; do not submit again.',{remote_task_id:id,...(lastError?{last_error:lastError.code}:{}),retry_automatically:false});
}
export async function generate(connection,kind,args,timeout) {
  assertModelAllowed(args.model,kind);
  validateArguments(toolFor(connection.tools,`generate_${kind}`),args);
  const canvas=await request(connection.cfg,'/canvas/create',{method:'POST',data:{title:'SealSeek Media CLI',description:'Media generation',tags:['CLI']}});
  requireValue(canvas?.id!==undefined,'OUTPUT_CONTRACT_FAILED','Infinite Canvas returned no canvas ID.');
  const context={canvasId:String(canvas.id),traceId:connection.traceId||crypto.randomUUID()};
  await connection.onContext?.(context);
  const editing=connection.operation;
  const route=editing==='quick-edit'?'/canvas/image/quickEditRun':editing==='replace-text'?'/canvas/image/editText':'/canvas/tasks/generate';
  const input=editing?{canvasId:context.canvasId,imageUrl:args.reference_images[0],model:args.model,...(editing==='quick-edit'?{prompt:args.prompt}:{edits:[connection.editParams]})}:generationPayload(kind,args,context);
  if(editing)validateNativeInput(editing==='quick-edit'?'QuickEditRunParam':'EditTextParam',input);
  const result=await request(connection.cfg,route,{method:'POST',data:input,submission:true});
  const id=taskId(result);await connection.onSubmitted?.({remote_task_id:id,...context});
  return pollTask(connection.cfg,id,{timeout});
}
export async function call(connection,name,args,timeout=900000) {
  if(name.startsWith('generate_'))return [await generate(connection,name.slice(9),args,timeout)];
  if(name==='list_artifacts')return [await request(connection.cfg,'/canvas/myWorksArtifact',{method:'POST',data:{worksType:args.type==='image'?1:args.type==='video'?2:0,viewType:1,pageNum:args.pageNum||1,pageSize:args.pageSize||10}})];
  throw new MediaError('CAPABILITY_UNAVAILABLE',`Infinite Canvas operation ${name} is unavailable.`);
}
