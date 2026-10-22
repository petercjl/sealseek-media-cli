import fs from 'node:fs/promises';
import path from 'node:path';
import { requireValue, MediaError, secureUrl, hash } from './core.mjs';
import { toolFor, validateArguments, call,request,API,authenticatedFetch,generationPayload,validateNativeInput } from './canvas.mjs';
import {archiveOptions} from './placement.mjs';
import {MODEL_POLICY,assertModelAllowed} from './model-policy.mjs';
import { validateModel } from './models.mjs';
import {assetUri,resolveVideoReference,reviewReference,validateReferencePeople,REVIEW_POLICY} from './asset-review.mjs';
import {mapLimited} from './concurrency.mjs';

const MIME = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
export async function reference(value,kind='image') {
  if(assetUri(value)){requireValue(['image','video'].includes(kind),'FEATURE_UNSUPPORTED','Asset URI inputs are supported for video image and video references.');return {url:value,asset:true};}
  if (/^https?:\/\//i.test(value)) return { url: secureUrl(value).href };
  const file = path.resolve(value), stat = await fs.stat(file).catch(() => null);
  requireValue(stat?.isFile() && stat.size > 0 && stat.size <= (kind==='image'?30:200) * 1024 * 1024, 'INVALID_REFERENCE', 'Reference file is missing, empty, or exceeds the local upload limit.');
  const mime = (kind==='image'?MIME:kind==='video'?{'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'}:{'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4'})[path.extname(file).toLowerCase()];
  requireValue(mime, 'INVALID_REFERENCE', `Unsupported ${kind} reference format.`);
  const bytes = await fs.readFile(file);
  const valid = mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : mime === 'image/webp' ? bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' : /^GIF8[79]a/.test(bytes.toString('ascii',0,6));
  requireValue(kind==='image'?valid:kind==='video'?(bytes.toString('ascii',4,8)==='ftyp'||bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]))):(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255||bytes.toString('ascii',0,4)==='RIFF'||bytes.toString('ascii',4,8)==='ftyp'), 'INVALID_REFERENCE', 'The reference content does not match its extension.');
  return { file, mime, digest: hash(bytes), size: stat.size };
}
export function validateVideoOptions(extra,options,duration) {
  const common=['motionIntensity','style'],seed25=['omniReferenceTaskType'],seed20=['videoWebSearch'];
  const allowed=[...common,...(options.model==='doubao-seedance-2-5'?seed25:[]),...(/^doubao-seedance-2-0/.test(options.model)?seed20:[])];
  requireValue(extra&&typeof extra==='object'&&!Array.isArray(extra),'INVALID_INPUT','Video options must be a JSON object.');
  requireValue(Object.keys(extra).every(k=>allowed.includes(k)),'FEATURE_UNSUPPORTED','Video options include unsupported fields for this model.',{allowed_fields:allowed});
  validateNativeInput('VideoParams',extra);
  requireValue(!extra.omniReferenceTaskType||['reference','edit','extend','auto'].includes(extra.omniReferenceTaskType),'FEATURE_UNSUPPORTED','Invalid Seedance 2.5 task mode.');
  requireValue(!extra.videoWebSearch||!((options.reference||[]).length||(options['video-reference']||[]).length||options.first||options.last||options['audio-reference']),'FEATURE_UNSUPPORTED','Web search enhancement requires text-only input.');
  return extra;
}
export async function prepare(kind, options, tools, catalog) {
  requireValue(['image','video'].includes(kind), 'INVALID_INPUT', 'Expected image or video.');
  requireValue(!(options.prompt && options['prompt-file']), 'INVALID_INPUT', 'Use prompt or prompt-file once.');
  const prompt = options['prompt-file'] ? await fs.readFile(path.resolve(options['prompt-file']), 'utf8') : options.prompt;
  requireValue(typeof prompt === 'string' && prompt.trim(), 'INVALID_INPUT', 'A prompt is required.');
  options={...options,model:options.model||MODEL_POLICY[kind].default};
  const contract=validateModel(kind,options,{tools,catalog});
  const args = { prompt: prompt.trim(), model: options.model };
  if (!options.size) {args.aspect_ratio=options.ratio||contract.defaults.ratio;args.resolution=options.resolution||contract.defaults.resolution;}
  else {if(options.ratio)args.aspect_ratio=options.ratio;if(options.resolution)args.resolution=options.resolution;}
  if (options.size) { requireValue(kind === 'image', 'FEATURE_UNSUPPORTED', 'Pixel size is available for images only.'); args.size = options.size; }
  for (const [flag, name] of [['count','num'],['duration','duration']]) if (options[flag] !== undefined) {
    const value = Number(options[flag]); requireValue(Number.isInteger(value) && value > 0, 'INVALID_INPUT', `${flag} must be a positive integer.`);
    requireValue(kind === (flag === 'count' ? 'image' : 'video'), 'FEATURE_UNSUPPORTED', `${flag} is not supported for ${kind}.`); args[name] = value;
  }
  // Provider catalog choices constrain the native request contract.
  if (kind === 'image') {
    args.num ??= 1;
    requireValue(args.num <= 4, 'FEATURE_UNSUPPORTED', 'Generate at most four images per request.');
    if (args.size) requireValue(/^[1-9]\d*x[1-9]\d*$/.test(args.size), 'INVALID_INPUT', 'Pixel size must use positive integers WxH.');
  } else {
    args.duration ??= contract.defaults.duration;
  }
  if(options['video-options']) {
    requireValue(kind==='video','FEATURE_UNSUPPORTED','--video-options is a video input.');
    let extra;try{extra=JSON.parse(await fs.readFile(path.resolve(options['video-options']),'utf8'));}catch{throw new MediaError('INVALID_INPUT','Video options must be a readable JSON object file.');}
    args.video_options=validateVideoOptions(extra,options,args.duration);
  }
  const refs = await Promise.all((options.reference || []).map(v=>reference(v)));
  requireValue(kind==='video'||!refs.some(r=>r.asset),'FEATURE_UNSUPPORTED','Asset URI references are supported for video generation only.');
  if (refs.length) args.reference_images = refs.map(r => r.url || 'https://reference.invalid/pending-upload.png');
  const first = options.first ? await reference(options.first) : null, last = options.last ? await reference(options.last) : null;
  requireValue(kind === 'video' || (!first && !last), 'FEATURE_UNSUPPORTED', 'First and last frames are video inputs.');
  if (first) args.first_frame_image = first.url || 'https://reference.invalid/pending-upload.png';
  if (last) args.last_frame_image = last.url || 'https://reference.invalid/pending-upload.png';
  const videoRefs=await Promise.all((options['video-reference']||[]).map(v=>reference(v,'video')));
  const audioRef=options['audio-reference']?await reference(options['audio-reference'],'audio'):null;
  if(videoRefs.length)args.reference_videos=videoRefs.map(r=>r.url||'https://reference.invalid/pending-upload.mp4');
  if(audioRef)args.reference_audio=audioRef.url||'https://reference.invalid/pending-upload.wav';
  if(options.audio!==undefined){requireValue(['true','false'].includes(options.audio),'INVALID_INPUT','Audio must be true or false.');args.generate_audio=options.audio==='true';}
  const tool = toolFor(tools, `generate_${kind}`); validateArguments(tool, args);
  generationPayload(kind,args,{canvasId:'dry-run',traceId:'dry-run'});
  if(kind==='video')validateReferencePeople(refs,first,last,options);
  else requireValue(['reference-person','first-person','last-person'].every(k=>options[k]===undefined),'FEATURE_UNSUPPORTED','Person classification applies to video only; image generation and editing do not submit asset reviews.');

  options={...options,session:options.session||process.env.SEALSEEK_MEDIA_SESSION_ID||process.env.CODEX_THREAD_ID};
  requireValue(!options.session||typeof options.session==='string'&&options.session.length<=200,'INVALID_INPUT','Session ID must be 1-200 characters.');
  if(options.canvas)requireValue(/^[A-Za-z0-9_-]{1,100}$/.test(options.canvas),'INVALID_INPUT','Provide a valid canvas ID.');
  const archival=await archiveOptions(options);
  requireValue(archival.placement.mode!=='explicit'||archival.placement.positions.length===(args.num||1),'INVALID_INPUT','Provide one placement position per requested output.');
  return { kind,...archival,canvas_id:options.canvas||null,canvas_session:options.session||null, transport:'infinite-canvas',tool: tool.name, args, refs, first, last,videoRefs,audioRef,model_contract:contract,...(kind==='video'?{reference_review:REVIEW_POLICY}:{}), output: options.output ? path.resolve(options.output) : null };
}
export async function upload(connection, ref) {
  if (ref.url) return ref.url;
  const bytes = await fs.readFile(ref.file);
  requireValue(hash(bytes) === ref.digest, 'REFERENCE_CHANGED', 'A reference changed after validation. Prepare a new request.');
  const form=new FormData();form.append('file',new Blob([bytes],{type:ref.mime}),path.basename(ref.file));
  const response=await authenticatedFetch(new URL(API+'/common/upload',connection.cfg.url.origin),{method:'POST',headers:connection.cfg.headers,body:form,redirect:'error',signal:AbortSignal.timeout(60000)});
  requireValue(response.ok,'UPLOAD_FAILED','Reference upload failed.');
  const body=await response.json();requireValue(body.code===200&&typeof body.data==='string','UPLOAD_FAILED','Infinite Canvas returned no uploaded file URL.');secureUrl(body.data);return body.data;
}
export function mediaUrls(values, kind) {
  const out = new Set();
  const walk = value => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
        const candidate = match[0].replace(/[.,;]+$/, '');
        try { const u = secureUrl(candidate); if ((kind === 'image' ? /\.(png|jpe?g|webp|gif)$/i : /\.(mp4|webm|mov)$/i).test(u.pathname)) out.add(u.href); } catch {}
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  values.forEach(walk); return [...out];
}
export async function download(urls, kind, directory, id) {
  await fs.mkdir(directory, { recursive: true });
  const files = [];
  for (let i=0;i<urls.length;i++) {
    const u = secureUrl(urls[i]);
    const ext = path.extname(u.pathname).toLowerCase();
    const target = path.join(directory, `${kind === 'image' ? '图片' : '视频'}-${id.slice(0,8)}-${i+1}${ext}`);
    // Reserve before fetching; existing user files are never replaced.
    const handle = await fs.open(target, 'wx', 0o600).catch(e => { if (e.code === 'EEXIST') throw new MediaError('TARGET_EXISTS', 'A destination file already exists.'); throw e; });
    try {
      const response = await fetch(u, { signal: AbortSignal.timeout(120000) });
      requireValue(response.ok, 'DOWNLOAD_FAILED', 'The generated asset could not be downloaded.');
      const bytes = Buffer.from(await response.arrayBuffer());
      requireValue(bytes.length > 0 && !/text\/|application\/json/.test(response.headers.get('content-type') || ''), 'OUTPUT_CONTRACT_FAILED', 'The asset response is not media.');
      await handle.writeFile(bytes); files.push({ path: target, size: bytes.length, sha256: hash(bytes), mime_type: response.headers.get('content-type') });
    } finally { await handle.close(); }
  }
  return files;
}
export async function execute(connection, request, timeout) {
  assertModelAllowed(request.args.model,request.kind);
  connection.canvasId=request.canvas_id||connection.canvasId;
  const args = { ...request.args };
  // Validate all inputs first, including older saved jobs, before any upload/review.
  if(request.kind==='video'){
    generationPayload('video',args,{canvasId:'preflight',traceId:'preflight'});
    validateReferencePeople(request.refs,request.first,request.last);
  }
  await connection.onStage?.('references_started');
  // Identical review identities run serially, allowing the existing private
  // review cache to be reused without concurrent duplicate registrations.
  const identities=new Map();
  const inputs=[...request.refs.map((ref,index)=>({ref,role:'reference',index})),...(request.first?[{ref:request.first,role:'first'}]:[]),...(request.last?[{ref:request.last,role:'last'}]:[]),...(request.videoRefs||[]).map((ref,index)=>({ref,role:'video',index})),...(request.audioRef?[{ref:request.audioRef,role:'audio'}]:[])];
  const groups=[];
  for(const input of inputs){const key=hash({reference:input.ref.digest||input.ref.url,person:input.ref.person,role:['video','audio'].includes(input.role)?input.role:'image'});let group=identities.get(key);if(!group){group=[];identities.set(key,group);groups.push(group);}group.push(input);}
  const resolved=await mapLimited(groups,async group=>{
    const results=[];
    for(const input of group){const {ref,role,index=0}=input;const url=request.kind==='video'&&role==='video'?await reviewReference(connection,ref,{upload,role,index}):request.kind==='video'&&role!=='audio'?await resolveVideoReference(connection,ref,{upload,role,index}):await upload(connection,ref);results.push({...input,url});}
    return results;
  });
  if(request.refs.length)args.reference_images=new Array(request.refs.length);
  if(request.videoRefs?.length)args.reference_videos=new Array(request.videoRefs.length);
  for(const {role,index,url} of resolved.flat()){
    if(role==='reference')args.reference_images[index]=url;
    else if(role==='first')args.first_frame_image=url;
    else if(role==='last')args.last_frame_image=url;
    else if(role==='video')args.reference_videos[index]=url;
    else args.reference_audio=url;
  }
  await connection.onStage?.('references_completed');
  connection.operation=request.operation;connection.editParams=request.edit_params;
  await connection.onPreparedArguments?.(args);
  const values = await call(connection, request.tool, args, timeout);
  return generationResult(values,request);
}
export function generationResult(values,request){
  const urls = mediaUrls(values.map(v=>({outputs:v[request.kind==='image'?'images':'videos'],resultUrl:v.resultUrl})), request.kind);
  requireValue(urls.length, 'OUTPUT_CONTRACT_FAILED', 'The generation tool returned no usable media URL. Inspect history before resubmitting.');
  const messages=values.filter(v=>typeof v==='string').join('\n');
  const amount=/扣费[：:]\s*(\d+(?:\.\d+)?)\s*积分/.exec(messages);
  return { urls, requested_model: request.args.model, actual_model: null, count: urls.length,cost:values[0]?.billingXidou!=null?{amount:values[0].billingXidou,unit:'SealSeek credits'}:amount?{amount:Number(amount[1]),unit:'SealSeek credits'}:null };
}
