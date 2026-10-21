import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, META, stateRoot, requireValue, hash, readJson, createJson, replaceJob, publicError } from './core.mjs';
import { connect,desktopConfig,pollTask,request as canvasRequest } from './canvas.mjs';
import {DEFAULT_PLACEMENT} from './placement.mjs';
import {selectCanvas,archiveMedia,accountScope,generationParams} from './boards.mjs';
import { execute, download,generationResult } from './media.mjs';

export const DEFAULT_TASK_TIMEOUT=1800;
export function timingSummary(job) {
  const t=job.timings||{},duration=(start,end)=>start&&end&&Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))?Math.max(0,Date.parse(end)-Date.parse(start)):null;
  return {source:'client-observed',timestamps:{created_at:job.created_at||null,...t,completed_at:job.completed_at||null},durations_ms:{preparation:duration(job.created_at,t.submitted_at),references:duration(t.references_started_at,t.references_completed_at),remote_wait:duration(t.submitted_at,t.remote_completed_at),finalization:duration(t.remote_completed_at,job.completed_at),total:duration(job.created_at,job.completed_at)}};
}

export function jobPath(id) {
  requireValue(/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id), 'INVALID_INPUT', 'Expected a local task UUID.');
  return path.join(stateRoot(), 'jobs', `${id}.json`);
}
export async function getJob(id) {
  const job = await readJson(jobPath(id)).catch(() => null);
  requireValue(job?.owner === META.name && job.id === id, 'TASK_NOT_FOUND', 'The local task does not exist.');
  // A vanished worker cannot safely be restarted: the provider may have charged.
  if (['running','generated'].includes(job.status) && job.pid && Date.now()-Date.parse(job.worker_started_at||job.started_at)>30000) {
    let gone=false; try { process.kill(job.pid,0); } catch(e) { gone=e.code==='ESRCH'; }
    if (gone) {
      job.status=job.result ? 'download_failed' : 'uncertain';job.phase=job.status;
      job.error={code:'WORKER_EXITED',message:'Worker exited. Inspect stored URLs and SealSeek history before any new generation.'};
      job.completed_at=new Date().toISOString(); await replaceJob(jobPath(id),job);
    }
  }
  return job;
}
export function summary(job) {
  return { ok: !['failed','uncertain','download_failed'].includes(job.status), task_id: job.id, status: job.status, phase:job.phase||job.status, remote_status:job.remote_status||null, tracking_timeout_seconds:job.timeout??null, timing:timingSummary(job), kind: job.request.kind, transport:job.request.transport||'legacy-mcp',remote_task_id:job.remote?.remote_task_id||null,canvas_id:job.remote?.canvasId||job.request.canvas_id||null,canvas_url:job.canvas_sync?.canvas_url||job.request.canvas_url||null,archive:job.request.archive||'canvas',placement:job.request.placement||null,canvas_saved:job.canvas_sync?.saved??null,canvas_sync_error:job.canvas_sync_error||null,model: job.request.args.model, actual_model: job.result?.model_verified ? job.result.actual_model : null, requested_count: job.request.args.num || 1, actual_count: job.result?.count ?? null, reference_reviews:job.reference_reviews||[], artifacts: job.files || [], urls: job.result?.urls || [], cost: job.result?.cost ?? null, ...(job.error ? { error: job.error } : {}), warnings: job.canvas_sync_error ? ['Media was generated, but canvas archival needs task sync. Do not regenerate.'] : job.status === 'uncertain' ? ['Inspect SealSeek history before any new submission.'] : job.result?.count < (job.request.args.num || 1) ? ['Provider returned fewer results than requested.'] : [] };
}
export async function submit(request, options) {
  requireValue(options.submit === true, 'SUBMIT_REQUIRED', 'Real generation requires --submit.');
  requireValue(!options.via || options.via === 'sealseek', 'INVALID_INPUT', 'This CLI executes SealSeek media requests.');
  requireValue(!options['dry-run'], 'INVALID_INPUT', 'Choose dry-run or submit.');
  const timeout = Number(options.timeout || DEFAULT_TASK_TIMEOUT);
  requireValue(Number.isInteger(timeout) && timeout >= 10 && timeout <= 3600, 'INVALID_INPUT', 'Timeout must be 10-3600 seconds.');
  // Canvas selection needs credentials, not another model catalog fetch.
  const cfg=await desktopConfig(options);
  Object.assign(request,await selectCanvas(cfg,request.canvas_id,request.canvas_session));
  const customPlacement=request.placement&&Object.entries(request.placement).some(([k,v])=>DEFAULT_PLACEMENT[k]!==v);
  const digest = hash({...(request.archive==='none'?{archive:'none'}:{}),...(customPlacement?{placement:request.placement}:{}),canvas_id:request.canvas_id,account_scope:request.account_scope, kind: request.kind, args: request.args, refs: request.refs, first: request.first, last: request.last,...(request.videoRefs?.length?{videoRefs:request.videoRefs}:{}),...(request.audioRef?{audioRef:request.audioRef}:{}),...(request.operation?{operation:request.operation,edit_params:request.edit_params}:{}) });
  const index = path.join(stateRoot(), 'requests', `${digest}${options.new ? '-' + crypto.randomUUID() : ''}.json`);
  const id = crypto.randomUUID();
  try { await createJson(index, { owner: META.name, id }); }
  catch (e) { if (e.code === 'EEXIST') { const old = await readJson(index); const job = await getJob(old.id); return { ...summary(job), deduplicated: true }; } throw e; }
  const configOptions = { ...(options.config ? { config: path.resolve(options.config) } : {}), ...(options.server ? { server: options.server } : {}) };
  const job = { owner: META.name, version: META.version, id, digest, created_at: new Date().toISOString(), status: 'queued', request, configOptions, timeout };
  await createJson(jobPath(id), job);
  const child = spawn(process.execPath, [path.join(ROOT,'bin','sealseek-media.mjs'), '_worker', id], { detached: true, stdio: 'ignore', env: process.env });
  try { await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); }); }
  catch { job.status='failed';job.error={code:'WORKER_START_FAILED',message:'The generation worker could not start.'};await replaceJob(jobPath(id),job);return summary(job); }
  child.unref();
  return summary(job);
}
export async function worker(id) {
  const job = await getJob(id), p = jobPath(id);
  requireValue(job.status === 'queued', 'TASK_ALREADY_STARTED', 'This task has already started.');
  job.status = 'running'; job.worker_started_at = new Date().toISOString(); job.started_at ||= job.worker_started_at; job.phase='preparing';job.pid = process.pid;job.timings||={};
  await replaceJob(p,job);
  let connection;
  try {
    connection = await connect(job.configOptions);
    requireValue(!job.request.account_scope||await accountScope(connection.cfg)===job.request.account_scope,'AUTH_REJECTED','The authenticated account changed after task preparation. Sign in to the original account.');
    connection.traceId=job.id;
    // Concurrent reference callbacks share one task file. Serialize mutation and
    // atomic persistence, and await each callback before advancing the worker.
    let writes=Promise.resolve();
    const persist=update=>{writes=writes.then(async()=>{update();await replaceJob(p,job);});return writes;};
    connection.onStage=async stage=>persist(()=>{job.timings[stage+'_at']||=new Date().toISOString();job.phase=stage==='references_started'?'preparing_references':'submitting';});
    connection.onProgress=async ({status})=>{if(job.remote_status===status)return;await persist(()=>{job.remote_status=status;job.remote_status_observed_at=new Date().toISOString();job.phase='waiting_remote';if(['done','success','succeeded'].includes(status))job.timings.remote_completed_at||=job.remote_status_observed_at;});};
    connection.onPreparedArguments=async args=>{job.executed_arguments=args;await replaceJob(p,job);};
    connection.onReferenceReview=async review=>persist(()=>{job.reference_reviews||=[];const i=job.reference_reviews.findIndex(v=>v.role===review.role&&v.index===review.index);if(i<0)job.reference_reviews.push(review);else job.reference_reviews[i]=review;});
    connection.onContext=async context=>{job.remote=context;await replaceJob(p,job);};
    connection.onSubmitted=async remote=>{job.remote=remote;job.timings.submitted_at||=new Date().toISOString();job.phase='waiting_remote';await replaceJob(p,job);};
    job.result = job.resume_only?generationResult([await pollTask(connection.cfg,job.remote.remote_task_id,{timeout:job.timeout*1000,onProgress:connection.onProgress})],job.request):await execute(connection, job.request, job.timeout*1000);
    // Persist remote output before downloading so download failure never causes regeneration.
    job.status = 'generated';job.phase='generated';job.timings.remote_completed_at||=new Date().toISOString();await replaceJob(p,job);
    try{if(job.request.archive!=='none'){job.phase='archiving';await replaceJob(p,job);job.canvas_sync=await archiveJob(connection.cfg,job);job.timings.archival_completed_at=new Date().toISOString();}delete job.canvas_sync_error;}catch(e){job.canvas_sync_error=publicError(e);}
    await replaceJob(p,job);
    if (job.request.output){job.phase='downloading';await replaceJob(p,job);job.files = await download(job.result.urls, job.request.kind, job.request.output,job.id);job.timings.download_completed_at=new Date().toISOString();}
    job.status = 'succeeded';
  } catch (e) {
    job.error = publicError(e);
    job.status = job.result ? 'download_failed' : ['SUBMISSION_UNCERTAIN','OUTPUT_CONTRACT_FAILED'].includes(e.code)||e.code==='AUTH_REJECTED'&&job.remote?.remote_task_id ? 'uncertain' : 'failed';
  } finally {
    await connection?.close().catch(() => {});
    job.phase=job.status;job.completed_at = new Date().toISOString(); await replaceJob(p,job);
  }
}
export async function resumeJob(id){
  const job=await getJob(id);requireValue(job.remote?.remote_task_id,'FEATURE_UNSUPPORTED','This task has no saved Infinite Canvas task ID. Inspect artifact history.');
  if(['queued','running','generated','succeeded'].includes(job.status))return {...summary(job),deduplicated:true};
  requireValue(!job.result,'INVALID_INPUT','This task already has output URLs. Use task download into a fresh directory.');
  job.resume_only=true;job.status='queued';job.phase='queued';delete job.completed_at;delete job.error;delete job.pid;job.resume_count=(job.resume_count||0)+1;await replaceJob(jobPath(id),job);
  const child=spawn(process.execPath,[path.join(ROOT,'bin/sealseek-media.mjs'),'_worker',id],{detached:true,stdio:'ignore',env:process.env});
  try{await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});child.unref();}catch{job.status='uncertain';job.phase='uncertain';job.error={code:'WORKER_START_FAILED',message:'Resume worker could not start; the remote task was not resubmitted.'};await replaceJob(jobPath(id),job);}
  return summary(job);
}
export async function waitJob(id, seconds = 30) {
  requireValue(Number.isInteger(seconds) && seconds > 0 && seconds <= 60, 'INVALID_INPUT', 'Wait interval must be 1-60 seconds.');
  const end=Date.now()+seconds*1000;
  while (true) {
    const job = await getJob(id);
    if (!['queued','running','generated'].includes(job.status) || Date.now()>=end) return summary(job);
    await new Promise(r => setTimeout(r,1000));
  }
}

async function archiveJob(cfg,job){
 const task=await canvasRequest(cfg,'/canvas/tasks/'+encodeURIComponent(job.remote.remote_task_id));
 return archiveMedia(cfg,job.remote.canvasId,{id:job.remote.remote_task_id,kind:job.request.kind,urls:job.result.urls,ratio:job.request.args.aspect_ratio,order:job.created_at,generationParams:generationParams(job.executed_arguments||job.request.args,task),placement:job.request.placement?.mode==='explicit'?{...job.request.placement,positions:job.request.placement.positions.slice(0,job.result.urls.length)}:job.request.placement});
}
export async function syncJob(id){
 const job=await getJob(id);requireValue(job.result?.urls?.length&&job.remote?.canvasId,'INVALID_INPUT','This task has no generated media to archive.');
 const c=await connect(job.configOptions);try{requireValue(!job.request.account_scope||await accountScope(c.cfg)===job.request.account_scope,'AUTH_REJECTED','Sign in to the task account before archival.');job.canvas_sync=await archiveJob(c.cfg,job);delete job.canvas_sync_error;await replaceJob(jobPath(id),job);return summary(job);}finally{await c.close();}
}
