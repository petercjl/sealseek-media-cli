import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash,requireValue } from './core.mjs';
import { videoGuide } from './video-contract.mjs';

export function diagnose(job,summary) {
  let guide;try{if(job.request.kind==='video')guide=videoGuide(job.request.args.model);}catch(e){guide={model:job.request.args.model,error:{code:e.code,message:e.message}};}
  return {ok:true,task:summary,state_file:path.join('jobs',job.id+'.json'),
    submitted_arguments:job.executed_arguments||job.request.args,reference_reviews:job.reference_reviews||[],provider_error:job.error||null,
    provider_error_available:!!job.error?.details?.provider_text,
    recovery:{generation_will_not_be_repeated:true,history_command:['sealseek-media','artifacts','list','--type',job.request.kind,'--json'],
      next_action:job.result?.urls?.length?'Use task download with a fresh output directory.':job.status==='succeeded'?'Use task inspect to verify the saved files.':['queued','running','generated'].includes(job.status)?'Continue following this task ID.':'Read the error and match provider history before authorizing another generation.'},
    ...(guide?{model_guide:guide}:{})};
}
export async function inspectFile(artifact,{probe=(file)=>spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,duration:format=duration','-of','json',file],{encoding:'utf8',timeout:20000,windowsHide:true})}={}) {
  const bytes=await fs.readFile(artifact.path);
  requireValue(bytes.length===artifact.size&&hash(bytes)===artifact.sha256,'ARTIFACT_CHANGED','Saved artifact bytes differ from the task record.');
  const result={path:artifact.path,size:bytes.length,sha256:artifact.sha256,hash_verified:true};
  if(!/\.(mp4|webm|mov|png|jpe?g|webp|gif)$/i.test(artifact.path))return result;
  const r=probe(artifact.path);
  if(r.error?.code==='ENOENT')return {...result,media_metadata_available:false,error:{code:'INSPECTION_UNAVAILABLE',message:'Install ffprobe to inspect media dimensions and duration.'}};
  requireValue(r.status===0,'INSPECTION_FAILED','ffprobe could not inspect the saved video.');
  const data=JSON.parse(r.stdout),stream=data.streams?.[0];
  requireValue(stream?.width>0&&stream?.height>0,'INSPECTION_FAILED','The file has no readable video stream.');
  const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(stream.width,stream.height);
  const video=/\.(mp4|webm|mov)$/i.test(artifact.path);
  return {...result,media_metadata_available:true,width:stream.width,height:stream.height,pixel_ratio:`${stream.width/g}:${stream.height/g}`,...(video?{frame_rate:stream.r_frame_rate,video_duration_seconds:Number.isFinite(Number(stream.duration))?Number(stream.duration):null,container_duration_seconds:Number.isFinite(Number(data.format?.duration))?Number(data.format.duration):null}:{})};
}
export async function inspectTask(job,options) {
  requireValue(job.files?.length,'ARTIFACT_UNAVAILABLE','This task has no saved local files. Download stored output first.');
  const artifacts=[];for(const file of job.files)artifacts.push(await inspectFile(file,options));
  const requested=job.request.args.aspect_ratio,parts=/^(\d+):(\d+)$/.exec(requested||'');
  for(const a of artifacts){if(!a.media_metadata_available)continue;a.requested_ratio=requested||null;a.exact_requested_ratio=parts? a.width*Number(parts[2])===a.height*Number(parts[1]):null;if(job.request.kind==='video'){a.requested_duration_seconds=job.request.args.duration??null;a.duration_difference_seconds=a.video_duration_seconds!==null&&a.requested_duration_seconds!==null?Number((a.video_duration_seconds-a.requested_duration_seconds).toFixed(6)):null;}}
  return {ok:true,task_id:job.id,artifacts};
}
