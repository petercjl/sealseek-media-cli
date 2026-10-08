import fs from 'node:fs/promises';
import { requireValue } from './core.mjs';
import { authenticatedFetch,desktopConfig,sanitizeProviderText } from './service.mjs';

export const CATALOG=JSON.parse(await fs.readFile(new URL('./model-catalog.json',import.meta.url),'utf8'));
export const RUNTIME_EVIDENCE=JSON.parse(await fs.readFile(new URL('./runtime-evidence.json',import.meta.url),'utf8'));
export function validateCatalog(data) {
  const models=[...(data?.image||[]),...(data?.video||[])];
  requireValue(models.length>0&&models.every(m=>typeof m.id==='string'&&['image','video'].includes(m.type)&&Array.isArray(m.resolutions)&&m.resolutions.length&&m.resolutions.every(r=>typeof r==='string')&&Array.isArray(m.capabilities?.aspectRatios)&&m.capabilities.aspectRatios.length&&m.capabilities.aspectRatios.every(r=>typeof r==='string')&&Number.isInteger(m.capabilities.maxReferences)&&m.capabilities.maxReferences>=0&&['supportsReference','supportsFirstFrame','supportsLastFrame','supportsVideoReference','supportsAudio','supportsCameraControl','supportsStyleTransfer','supportsInpainting'].every(key=>typeof m.capabilities[key]==='boolean')&&Array.isArray(m.capabilities.modes)&&(m.type==='image'||Array.isArray(m.capabilities.durations)&&m.capabilities.durations.length&&m.capabilities.durations.every(n=>Number.isInteger(n)&&n>0))),'OUTPUT_CONTRACT_FAILED','SealSeek model catalog is incomplete.');
  requireValue(new Set(models.map(m=>m.id)).size===models.length,'OUTPUT_CONTRACT_FAILED','SealSeek model catalog contains duplicate IDs.');
  return models;
}
export async function liveCatalog(options={},cfg) {
  cfg??=await desktopConfig(options);
  const url=new URL('/api/sealseek-infinitecanvas/api/generation-models',cfg.url.origin);
  const r=await authenticatedFetch(url,{headers:cfg.headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  requireValue(r.ok,'CONNECTION_FAILED','SealSeek model catalog could not be read.');
  const body=await r.json();requireValue(body.code===200,'PROVIDER_FAILURE','SealSeek rejected model catalog discovery.');
  return {source:url.href,retrieved_at:new Date().toISOString(),evidence:'provider_catalog_declared',models:validateCatalog(body.data)};
}
export function modelContract(id,{catalog=CATALOG,tools}={}) {
  const m=catalog.models.find(m=>m.id===id);
  requireValue(m,'MODEL_UNAVAILABLE','Model is absent from the current SealSeek catalog.',{model:id,discovery_command:'sealseek-media models list --live --json'});
  const c=m.capabilities,tool=tools?.find(t=>t.name===`generate_${m.type}`),schema=tool?.inputSchema?.properties||{reference_images:{},...(m.type==='video'?{first_frame_image:{},last_frame_image:{},reference_videos:{},reference_audio:{},generate_audio:{},quality_mode:{}}:{})};
  const observed={tested_date:RUNTIME_EVIDENCE.tested_date,environment:RUNTIME_EVIDENCE.environment,scope:RUNTIME_EVIDENCE.scope,cases:RUNTIME_EVIDENCE.cases.filter(test=>test.model===id)};
  const included=!tools?null:!!tool&&(!schema?.model?.enum||schema.model.enum.includes(id));
  const capabilities={reference_images:{model_support:c.supportsReference,max:c.maxReferences,cli_flag:'--reference',transport_support:tools?included&&!!schema.reference_images:null},first_frame:{model_support:c.supportsFirstFrame,cli_flag:'--first',transport_support:tools?included&&!!schema.first_frame_image:null},last_frame:{model_support:c.supportsLastFrame,cli_flag:'--last',transport_support:tools?included&&!!schema.last_frame_image:null},reference_videos:{model_support:c.supportsVideoReference,max:c.maxVideoReferences,transport_support:!!schema?.reference_videos},audio_generation:{model_support:c.supportsAudio,transport_support:!!schema?.generate_audio},camera_control:{model_support:c.supportsCameraControl,transport_support:false},quality_modes:{values:c.modes,transport_support:!!schema?.quality_mode},style_transfer:{model_support:c.supportsStyleTransfer,transport_support:'prompt-and-image-reference'},inpainting:{model_support:c.supportsInpainting,transport_support:false}};
  return {model:m.id,name:m.name,type:m.type,provider:m.provider,source:catalog.source,retrieved_at:catalog.retrieved_at,evidence:catalog.evidence,resolutions:m.resolutions,ratios:c.aspectRatios,durations:c.durations||[],...(m.type==='image'?{count:{min:1,max:4,default:1,source:'Infinite Canvas UI and CLI contract'},pixel_size:{flag:'--size',transport_support:false,source:'Native real test: requested 1024x1536 returned 2048x2048; exact pixel-size selection is not verified.'}}:{}),capabilities,input_rules:{video_count:1,image_count_range:[1,4],last_requires_first:true,reference_modes_exclusive:true,audio_reference:{allowed_models:catalog.models.filter(x=>x.type==='video'&&/^doubao-seedance-2-[025]/.test(x.id)).map(x=>x.id),requires_visual_reference:m.id!=='doubao-seedance-2-5',max:1},image_tools:{quick_edit_models:['gpt-image-2','nano-banana-pro','nano-banana2'],replace_text_models:['gpt-image-2','nano-banana-pro','nano-banana2','seedream-5-0','seedream-5-0-lite']},advanced_video_options:{flag:'--video-options JSON_FILE',common:['motionIntensity','style'],seedance_2_5:{omniReferenceTaskType:['reference','edit','extend','auto'],outputFormat:['mp4','mov']},seedance_2_0:{videoWebSearch:'boolean; text-only'},kling_v3_omni:{videoReferType:['base','feature'],keepOriginalSound:'boolean; requires video reference',multiShot:'boolean; excludes video reference',multiShotPrompts:{supported:false,reason:'Native provider adapter rejected custom lists: missing index; blocked before submission.'}},provider_acceptance_verified:false},unexposed_native_parameters:['referenceAudios','imageParams.roles','imageParams.descriptions']},transport:{name:tool?.transport||'SealSeek Infinite Canvas REST',model_advertised:schema?.model?.enum?included:null,model_field_accepts:included,live_schema_checked:false,bundled_openapi_validated:true,live_catalog_checked:!!tools,request_contract_source:'official-infinite-canvas-openapi',unsupported_features:['exact_pixel_size','camera_control','inpainting_mask',...(!schema?.reference_audio?['reference_audio']:[])]},defaults:{ratio:'1:1',resolution:m.resolutions[0],...(m.type==='video'?{duration:(c.durations||[]).includes(5)?5:c.durations?.[0]}:{count:1})},observed_runtime:observed,validation:{catalog:'Provider-declared allowed choices; not proof that every combination generates successfully.',dry_run:'No generation or upload; checks catalog and the Infinite Canvas contract.',output:'Dimensions and duration can be rounded. Inspect actual output.',actual_model:'A requested model ID does not independently attest the served model.'}};
}
export function validateModel(kind,options,{catalog=CATALOG,tools}={}) {
  const contract=modelContract(options.model,{catalog,tools});
  requireValue(contract.type===kind,'FEATURE_UNSUPPORTED','Model type does not match the requested operation.',{model:options.model,type:contract.type});
  requireValue(contract.transport.model_field_accepts!==false,'FEATURE_UNSUPPORTED','This model is listed in SealSeek desktop, but is not advertised by the Infinite Canvas generation contract.',{model:options.model,contract});
  for(const [key,values] of [['ratio',contract.ratios],['resolution',contract.resolutions],['duration',contract.durations]]) if(options[key]!==undefined)requireValue(values.includes(key==='duration'?Number(options[key]):options[key]),'FEATURE_UNSUPPORTED',`Unsupported ${key} for this model.`,{model:options.model,field:key,allowed:values});
  const caps=contract.capabilities;
  requireValue(!options.size,'FEATURE_UNSUPPORTED','Explicit pixel-size control is not verified. Select --ratio and --resolution.',{rejected_flag:'--size',paid_action:false});
  const videoRefs=options['video-reference']||[];
  requireValue(!videoRefs.length||(kind==='video'&&caps.reference_videos.model_support&&caps.reference_videos.transport_support&&videoRefs.length<=caps.reference_videos.max),'FEATURE_UNSUPPORTED','Video references are unsupported or exceed the model limit.',{max:caps.reference_videos.max});
  requireValue(options.audio===undefined||(kind==='video'&&caps.audio_generation.model_support&&caps.audio_generation.transport_support),'FEATURE_UNSUPPORTED','The model does not support an audio generation toggle.');
  requireValue(!options['quality-mode']||(kind==='video'&&caps.quality_modes.transport_support&&caps.quality_modes.values.includes(options['quality-mode'])),'FEATURE_UNSUPPORTED','Unsupported quality mode.',{allowed:caps.quality_modes.values});
  requireValue(!options['audio-reference']||(kind==='video'&&/^doubao-seedance-2-[025]/.test(options.model)),'FEATURE_UNSUPPORTED','Audio references are declared for Seedance 2 series only.');
  requireValue(!options['audio-reference']||options.model==='doubao-seedance-2-5'||(options.reference||[]).length||videoRefs.length,'FEATURE_UNSUPPORTED','Seedance 2.0 audio reference requires at least one image or video reference.',{required_any:['--reference','--video-reference'],paid_action:false});
  requireValue(!(videoRefs.length||options['audio-reference'])||!(options.first||options.last),'FEATURE_UNSUPPORTED','Video/audio references use reference mode rather than first/last-frame mode.');
  for(const [flag,cap] of [['first',caps.first_frame],['last',caps.last_frame]])if(options[flag])requireValue(kind==='video'&&cap.model_support,'FEATURE_UNSUPPORTED',`This model does not support --${flag}.`,{model:options.model,rejected_flag:`--${flag}`,help_command:`sealseek-media models show ${options.model} --live --json`,paid_action:false});
  const refs=options.reference||[];
  requireValue(!refs.length||caps.reference_images.model_support&&refs.length<=caps.reference_images.max,'FEATURE_UNSUPPORTED','Reference images are unsupported or exceed this model limit.',{model:options.model,max:caps.reference_images.max});
  requireValue(!options.last||options.first,'INVALID_INPUT','A last-frame constraint requires a first frame.');
  requireValue(!(refs.length&&(options.first||options.last)),'FEATURE_UNSUPPORTED','Choose appearance references or first/last-frame constraints; the combined mode is not verified by this transport.');
  if(options.model==='happyhorse-i2v')requireValue(options.first,'INVALID_INPUT','HappyHorse i2v requires --first.');
  if(options.model==='happyhorse-r2v')requireValue(refs.length,'INVALID_INPUT','HappyHorse r2v requires --reference.');
  return contract;
}
export async function estimate(options,contract,cfg) {
  for(const [key,values] of [['ratio',contract.ratios],['resolution',contract.resolutions],['duration',contract.durations]])if(options[key]!==undefined)requireValue(values.includes(key==='duration'?Number(options[key]):options[key]),'FEATURE_UNSUPPORTED',`Unsupported ${key} for this model.`,{allowed:values});
  requireValue(contract.type==='image'||!options.count,'FEATURE_UNSUPPORTED','Count is image-only.');
  requireValue(options.count===undefined||Number.isInteger(Number(options.count))&&Number(options.count)>=1&&Number(options.count)<=4,'INVALID_INPUT','Count is 1-4.');
  cfg??=await desktopConfig(options);
  const input={modelKey:contract.model,resolution:options.resolution||contract.defaults.resolution,aspectRatio:options.ratio||contract.defaults.ratio,...(contract.type==='video'?{duration:Number(options.duration??contract.defaults.duration)}:{num:Number(options.count||1)})};
  const r=await authenticatedFetch(new URL('/api/sealseek-infinitecanvas/model/cost-estimate',cfg.url.origin),{method:'POST',headers:{...cfg.headers,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(20000)});
  requireValue(r.ok,'CONNECTION_FAILED','SealSeek cost estimate could not be read.');
  const b=await r.json();requireValue(b.code===200,'PROVIDER_FAILURE','SealSeek rejected the cost estimate.',{provider_text:sanitizeProviderText(b.msg||''),paid_action:false});
  return {ok:true,paid_action:false,model:contract.model,parameters:input,estimate:b.data,provider_acceptance_verified:false,note:'Pricing lookup does not prove parameter compatibility or successful generation.'};
}
