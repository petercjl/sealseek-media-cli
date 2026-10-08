#!/usr/bin/env node
import fs from 'node:fs/promises';
import {MODEL_POLICY,assertModelAllowed} from '../src/model-policy.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, META, MediaError, requireValue, parse, publicError } from '../src/core.mjs';
import { connect, desktopConfig, call,request as canvasRequest,NATIVE_CONTRACT,validateNativeInput } from '../src/canvas.mjs';
import { prepare, reference, upload, download } from '../src/media.mjs';
import { submit, getJob, summary, waitJob, worker,resumeJob } from '../src/jobs.mjs';
import { SOURCE, status, install } from '../src/skills.mjs';
import { localAuthStatus,logout } from '../src/auth.mjs';
import { startLogin,loginStatus,serveLogin } from '../src/auth-web.mjs';
import { latestVersion,performUpdate,updateStatus,setAutomatic } from '../src/update.mjs';
import { videoGuide } from '../src/video-contract.mjs';
import { diagnose,inspectTask } from '../src/diagnostics.mjs';
import { CATALOG,liveCatalog,modelContract,estimate } from '../src/models.mjs';
import { verifyCredentials } from '../src/service.mjs';

const HELP=`sealseek-media ${META.version}
SealSeek image and video generation. Routing is configured in the calling Agent. Node.js >=22.

  version
  doctor [--live] --json
  capabilities [--live] --json
  models list [--type image|video] [--live] --json
  models show ID [--live] --json       (all parameters and transport limitations)
  models estimate ID [--resolution VALUE] [--ratio RATIO]
    [--duration SECONDS | --count N] --json (read-only pricing; no generation)
  auth status [--live] [--login-id UUID] --json
  auth login [--device client|web] [--method sms|wechat] --json                  (local webpage; default CLIENT channel and SMS login)
  auth logout [--desktop] --yes --json (private backups before credential removal)
  image generate [--model ID] --prompt TEXT [--reference FILE_OR_URL ...]
    [--ratio RATIO] [--resolution VALUE] [--count 1-4]
    [--prompt-file FILE] [--output DIR] [--dry-run | --submit] [--new] --json
  video guide [--model ID] --json       (reference modes, model constraints, workflow)
  video generate [--model ID] --prompt TEXT [--reference FILE_OR_URL ...]
    [--ratio RATIO] [--resolution VALUE] [--duration SECONDS]
    [--first FILE_OR_URL] [--last FILE_OR_URL]
    [--video-reference FILE_OR_URL ...] [--audio-reference FILE_OR_URL]
    [--audio true|false] [--video-options JSON_FILE]
    [--prompt-file FILE] [--output DIR] [--timeout SECONDS]
    [--dry-run | --submit] [--new] --json
    Video has one output per request; --count is image-only.
    Exact pixel size is not verified; use catalog ratio/resolution choices.
  image edit --image FILE_OR_URL --prompt TEXT [--model ID]
    [--output DIR] [--dry-run | --submit] --json
  image detect-text --image FILE_OR_URL --submit --json
  image replace-text --image FILE_OR_URL --old-text TEXT --new-text TEXT
    [--box x1,y1,x2,y2] [--output DIR] [--dry-run | --submit] --json
  image upload FILE --submit --json
  task get ID --json
  task resume ID --json               (queries the saved remote task; no resubmission)
  task diagnose ID --json              (read-only; no generation replay)
  task inspect ID --json               (saved file hashes, dimensions and duration)
  task wait ID [--timeout 30] --json     (bounded wait, 1-60 seconds)
  task download ID --output DIR --json  (uses stored URLs, never regenerates)
  artifacts list [--type image|video] [--page N] [--limit N] --json
  skill source --json
  skill status|install|update --agent codex|workbuddy|sealseek [--path DIR] --json
  update check --json
  update install --yes --json
  update auto status|on|off --json

Desktop discovery: --config FILE, --server NAME. These override the current
user's SealSeek desktop configuration. Credentials stay outside this package.
Default image model: gpt-image-2.5-sunburst. Default video model: doubao-seedance-2-5.
Alternatives require an explicit --model selection; no automatic fallback.
Generation defaults to dry-run. --submit executes a real generation request.
Legacy --via sealseek is accepted for compatibility and is optional.
Same requests reuse the saved local task; --new explicitly creates another.
`;
const common=['json','config','server'];
const out=value=>console.log(JSON.stringify(value,null,2));
async function withConnection(options,fn) { const c=await connect(options); try { return await fn(c); } finally { await c.close(); } }
async function main(argv) {
  const [command, action, ...rest]=argv;
  if (!command || ['--help','-h','help'].includes(command)) return console.log(HELP);
  if (['image','video'].includes(command)&&['--help','help','-h'].includes(action))return console.log(HELP);
  if (['version','--version','-v'].includes(command)) return console.log(`sealseek-media ${META.version}`);
  if (command === '_worker') return worker(action);
  if(command==='_auth-worker')return serveLogin(action,{verify:async token=>verifyCredentials(await desktopConfig({authToken:token}))});
  if(command==='auth'){
    const {options,args}=parse(rest,[...common,'live','login-id','desktop','yes','device','method']);requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    if(action==='login')return out({ok:true,...await startLogin({device:options.device||'client',method:options.method||'sms'})});
    if(action==='logout')return out(await logout(options));
    if(action==='status'){
      if(options['login-id'])return out({ok:true,...await loginStatus(options['login-id'])});
      const v=await localAuthStatus(options);if(options.live)return out({...v,...await verifyCredentials(await desktopConfig(options))});
      return out({...v,verified:false});
    }
  }
  if(command==='models'){
    const {options,args}=parse(rest,[...common,'live','type','resolution','ratio','duration','count']);
    requireValue(!options.type||['image','video'].includes(options.type),'INVALID_INPUT','Type must be image or video.');
    const render=async(c,catalog)=>{
      if(action==='list'){requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');return out({ok:true,model_policy:MODEL_POLICY,source:catalog.source,retrieved_at:catalog.retrieved_at,models:catalog.models.filter(m=>!options.type||m.type===options.type).map(m=>modelContract(m.id,{catalog,tools:c?.tools}))});}
      requireValue(args.length===1,'INVALID_INPUT','Provide one model ID.');
      const contract=modelContract(args[0],{catalog,tools:c?.tools});
      if(action==='show')return out({ok:true,...contract});
      if(action==='estimate')return out(await estimate(options,contract,c?.cfg));
      throw new MediaError('UNKNOWN_COMMAND','Use models list, show or estimate.');
    };
    if(options.live)return withConnection(options,async c=>render(c,c.catalog));
    return render(null,CATALOG);
  }
  if (command === 'doctor' || command === 'capabilities') {
    const {options,args}=parse(argv.slice(1),[...common,'live']); requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    const manifest=JSON.parse(await fs.readFile(path.join(SOURCE,'capabilities.json'),'utf8'));
    if (command === 'capabilities' && !options.live) return out({ok:true,version:META.version,policy:'host-configured',model_policy:MODEL_POLICY,manifest,model_catalog:CATALOG});
    let config; try { config=await desktopConfig(options); } catch(e) { process.exitCode=1; return out({ok:false,version:META.version,node:process.version,platform:process.platform,error:publicError(e)}); }
    const result={ok:true,version:META.version,node:process.version,platform:process.platform,authentication:{present:true,source:config.source,...config.metadata},supported_platform:process.platform==='darwin', ...(command==='capabilities'?{manifest}:{})};
    if (options.live) return withConnection(options,async c=>{await verifyCredentials(c.cfg);return out({...result,...(command==='capabilities'?{model_catalog:c.catalog}:{}),tools:c.tools.filter(t=>['generate_image','generate_video','create_upload_urls','list_artifacts'].includes(t.name)),transport:'SealSeek Infinite Canvas REST'});});
    return out(result);
  }
  if(command==='video'&&action==='guide'){const {options,args}=parse(rest,[...common,'model','live']);requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');if(options.live)return withConnection(options,async c=>out({ok:true,...videoGuide(options.model,{catalog:c.catalog,tools:c.tools})}));return out({ok:true,...videoGuide(options.model)});}
  if(command==='image'&&['edit','replace-text','detect-text'].includes(action)){
    const {options,args}=parse(rest,[...common,'image','model','prompt','old-text','new-text','box','output','timeout','dry-run','submit','new']);requireValue(!args.length&&options.image,'INVALID_INPUT','Provide --image FILE_OR_URL.');
    if(action==='detect-text'){
      requireValue(!options.model,'INVALID_INPUT','Text detection is OCR and has no selectable generation model.');
      const ref=await reference(options.image);requireValue(options.submit&&!options['dry-run'],'SUBMIT_REQUIRED','Text detection requires --submit.');
      return withConnection(options,async c=>{const url=await upload(c,ref);out({ok:true,detection:await canvasRequest(c.cfg,'/canvas/image/editTextDetect',{method:'POST',data:{imageUrl:url}})});});
    }
    requireValue(action!=='replace-text'||options['old-text']&&options['new-text'],'INVALID_INPUT','Provide --old-text and --new-text.');
    const operationSchema=action==='edit'?'QuickEditRunParam':'EditTextParam';
    const allowed=NATIVE_CONTRACT.schemas[operationSchema].properties.model.enum;
    requireValue(allowed.includes(options.model||'nano-banana-pro'),'FEATURE_UNSUPPORTED','The selected model does not support this image operation.',{operation:action,allowed_models:allowed});
    assertModelAllowed(options.model||'nano-banana-pro','image');
    const opts={...options,model:options.model||'nano-banana-pro',prompt:action==='replace-text'?'Replace the specified image text.':options.prompt,reference:[options.image]};
    const prepared=await withConnection(options,async c=>prepare('image',opts,c.tools,c.catalog));
    prepared.operation=action==='edit'?'quick-edit':'replace-text';
    if(action==='replace-text'){
      prepared.edit_params={oldText:options['old-text'],newText:options['new-text']};
      if(options.box){const n=options.box.split(',').map(Number);requireValue(n.length===4&&n.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&n[0]<n[2]&&n[1]<n[3],'INVALID_INPUT','Box must be x1,y1,x2,y2 with increasing coordinates.');Object.assign(prepared.edit_params,{x1:n[0],y1:n[1],x2:n[2],y2:n[3]});}
    }
    validateNativeInput(operationSchema,{imageUrl:prepared.args.reference_images[0],model:prepared.args.model,...(action==='edit'?{prompt:prepared.args.prompt}:{edits:[prepared.edit_params]})});
    if(!options.submit)return out({ok:true,dry_run:true,paid_action:false,operation:prepared.operation,model:prepared.args.model,edit_parameters:prepared.edit_params||{prompt:prepared.args.prompt}});
    return out(await submit(prepared,options));
  }
  if (['image','video'].includes(command) && action === 'generate') {
    const {options,args}=parse(rest,[...common,'prompt','prompt-file','model','reference','video-reference','audio-reference','audio','video-options','ratio','resolution','size','count','duration','first','last','output','timeout','dry-run','via','submit','new'],['reference','video-reference']);
    requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    const request=await withConnection(options,async c=>prepare(command,options,c.tools,c.catalog));
    if (!options.submit) return out({ok:true,dry_run:true,paid_action:false,validation_scope:'live-model-catalog-and-infinite-canvas-contract',provider_acceptance_verified:false,kind:request.kind,tool:request.tool,arguments:request.args,model_contract:request.model_contract,...(request.reference_review?{reference_review:request.reference_review}:{}),local_uploads:[...request.refs,request.first,request.last,...request.videoRefs,request.audioRef].filter(r=>r?.file).length,output:request.output});
    return out(await submit(request,options));
  }
  if (command==='image' && action==='upload') {
    const {options,args}=parse(rest,[...common,'via','submit']); requireValue(args.length===1,'INVALID_INPUT','Provide one image file.');
    requireValue(options.submit,'SUBMIT_REQUIRED','Uploading requires --submit.');
    requireValue(!options.via || options.via==='sealseek','INVALID_INPUT','This CLI executes SealSeek media requests.');
    const ref=await reference(args[0]); return withConnection(options,async c=>out({ok:true,url:await upload(c,ref)}));
  }
  if (command==='task') {
    const {options,args}=parse(rest,['json','timeout','output']); requireValue(args.length===1,'INVALID_INPUT','Provide one task UUID.');
    if (action==='get') return out(summary(await getJob(args[0])));
    if(action==='resume')return out(await resumeJob(args[0]));
    if (action==='diagnose'){const job=await getJob(args[0]);return out(diagnose(job,summary(job)));}
    if (action==='inspect')return out(await inspectTask(await getJob(args[0])));
    if (action==='wait') return out(await waitJob(args[0],Number(options.timeout || 30)));
    if (action==='download') {
      const job=await getJob(args[0]); requireValue(job.result?.urls?.length && options.output,'INVALID_INPUT','Stored URLs and --output are required.');
      return out({ok:true,task_id:job.id,artifacts:await download(job.result.urls,job.request.kind,path.resolve(options.output),job.id)});
    }
  }
  if (command==='artifacts' && action==='list') {
    const {options,args}=parse(rest,[...common,'type','page','limit']); requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    const input={pageNum:Number(options.page || 1),pageSize:Number(options.limit || 10)};
    requireValue(Number.isInteger(input.pageNum)&&input.pageNum>0&&Number.isInteger(input.pageSize)&&input.pageSize>0&&input.pageSize<=50,'INVALID_INPUT','Page must be positive; limit is 1-50.');
    if (options.type) input.type=options.type;
    return withConnection(options,async c=>out({ok:true,artifacts:await call(c,'list_artifacts',input,30000)}));
  }
  if (command==='skill') {
    const {options,args}=parse(rest,['json','agent','path','force']); requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    if (action==='source') return out({ok:true,source:SOURCE,name:'sealseek-media',version:META.version});
    if (action==='status') return out(await status(options.agent,options.path));
    if (['install','update'].includes(action)) return out(await install(options.agent,options));
  }
  if (command==='update') {
    if(action==='auto') {
      const [mode,...flags]=rest;const {args}=parse(flags,['json']);requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
      if(mode==='status')return out({ok:true,...await updateStatus()});
      if(['on','off'].includes(mode))return out(await setAutomatic(mode==='on'));
      throw new MediaError('INVALID_INPUT','Use update auto status, on or off.');
    }
    const {options,args}=parse(rest,['json','yes']);requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    if(action==='check'){const latest=await latestVersion();return out({ok:true,current:META.version,latest,update_available:latest!==META.version});}
    if(action==='install') {requireValue(options.yes,'PERMISSION_REQUIRED','Package update requires --yes.');return out(await performUpdate({automatic:false}));}
  }
  throw new MediaError('UNKNOWN_COMMAND','Unknown command. Use sealseek-media --help.');
}
async function entry() {
  const argv=process.argv.slice(2);
  if(argv[0]&&!['_worker','_auth-worker','update'].includes(argv[0])&&process.env.SEALSEEK_MEDIA_AUTO_UPDATE!=='0') {
    const result=await performUpdate();
    if(result.skipped==='update_in_progress')throw new MediaError('UPDATE_BUSY','Another CLI is updating this package. Retry after the update finishes; no media request was submitted.');
    if(!result.ok)console.error(JSON.stringify({auto_update:result}));
    const installed=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8'));
    if(installed.version!==META.version) {
      console.error(JSON.stringify({auto_update:{version:installed.version,updated:true}}));
      const r=spawnSync(process.execPath,[path.join(ROOT,'bin','sealseek-media.mjs'),...argv],{stdio:'inherit',env:{...process.env,SEALSEEK_MEDIA_AUTO_UPDATE:'0'},windowsHide:true});
      process.exitCode=r.status??1;return;
    }
  }
  return main(argv);
}
entry().catch(e=>{out({ok:false,error:publicError(e)});process.exitCode=1;});
