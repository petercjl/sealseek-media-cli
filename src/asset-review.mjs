import fs from 'node:fs/promises';
import path from 'node:path';
import {META,stateRoot,hash,readJson,createJson,replaceJob,requireValue,MediaError} from './core.mjs';
import {request,validateNativeInput,sanitizeProviderText} from './canvas.mjs';

export const REVIEW_POLICY={automatic:true,scope:'person-containing-video-image-references-and-first-last-frames',detection:'caller-visual-inspection',classification_required:true,non_person_reference:'ordinary-url',image_generation_review:false,dry_run_performs_review:false,failed_review_blocks_generation:true};
export function assetUri(value){return typeof value==='string'&&/^asset:\/\/[A-Za-z0-9_-]+$/.test(value);}

// Classification belongs to the caller's visual inspection. The provider has
// no documented standalone person detector; auto-review registers an asset.
export function validateReferencePeople(refs,first,last,options) {
  const values=options?.['reference-person'];
  requireValue(values===undefined||Array.isArray(values)&&values.length===refs.length,'INVALID_INPUT','Provide one --reference-person present|absent per --reference, in matching order.');
  for(const [key,ref] of [['first-person',first],['last-person',last]])
    requireValue(options?.[key]===undefined||!!ref,'INVALID_INPUT',`--${key} requires its frame input.`);
  for(const [i,ref] of refs.entries())if(values?.[i]!==undefined)ref.person=values[i];
  if(first&&options?.['first-person']!==undefined)first.person=options['first-person'];
  if(last&&options?.['last-person']!==undefined)last.person=options['last-person'];
  for(const ref of [...refs,first,last].filter(Boolean)) {
    requireValue(ref.person===undefined||['present','absent'].includes(ref.person),'INVALID_INPUT','Person classification must be present or absent.');
    requireValue(assetUri(ref.url)||['present','absent'].includes(ref.person),'REFERENCE_CLASSIFICATION_REQUIRED','Inspect every video image reference and mark person present or absent before submission.',{generation_submitted:false,review_submitted:false});
  }
}

export async function resolveVideoReference(connection,ref,{upload,role,index=0}={}) {
  validateReferencePeople([ref],null,null);
  if(assetUri(ref.url)||ref.person==='present')return reviewReference(connection,ref,{upload,role,index});
  const url=await upload(connection,ref);
  await connection.onReferenceReview?.({role,index,status:'Skipped',person:'absent',reason:'no-person',cached:false});
  return url;
}

// Cache is private, scoped to the service and current credentials, and rechecked
// with the provider before reuse. Reference contents never go into the package.
export async function reviewReference(connection,ref,{upload,role='reference',index=0,timeout=180000,interval=3000,cacheDirectory=path.join(stateRoot(),'asset-reviews')}={}){
  if(ref.file)requireValue(hash(await fs.readFile(ref.file))===ref.digest,'REFERENCE_CHANGED','A reference changed after validation. Prepare a new request.');
  const key=hash({origin:connection.cfg.url.origin,credentials:Object.entries(connection.cfg.headers).sort(([a],[b])=>a.localeCompare(b)),reference:ref.digest||ref.url});
  const p=path.join(cacheDirectory,key+'.json');
  let saved;
  try{saved=await readJson(p);}catch(e){if(e.code!=='ENOENT')throw new MediaError('ASSET_REVIEW_STATE_INVALID','Stored reference review cannot be read.');}
  if(saved)requireValue(saved.owner===META.name&&saved.id===key&&typeof saved.assetId==='string'&&saved.assetId,'UNMANAGED_STATE','Reference review ownership or identity mismatch.');
  const cached=!!saved;
  const emit=async result=>connection.onReferenceReview?.({role,index,status:result.status,asset_id:result.assetId||null,asset_uri:result.assetUri||null,cached});
  const end=Date.now()+timeout;
  let result;
  if(saved)result=await request(connection.cfg,'/canvas/ark/status',{method:'POST',data:{assetId:saved.assetId}});
  else if(assetUri(ref.url))result=await request(connection.cfg,'/canvas/ark/status',{method:'POST',data:{assetId:ref.url.slice(8)}});
  else{
    const url=await upload(connection,ref);
    const data={url,assetType:'Image',name:'Video reference'};
    validateNativeInput('AssetValidateParam',data);
    try{result=await request(connection.cfg,'/canvas/ark/auto-review',{method:'POST',data,timeout:Math.min(70000,timeout),submission:true});}
    catch(e){if(e.code==='SUBMISSION_UNCERTAIN')throw new MediaError('ASSET_REVIEW_UNCERTAIN','Reference review response is unresolved; video generation was not submitted.',{generation_submitted:false,retry_automatically:false});throw e;}
  }
  while(true){
    requireValue(result&&typeof result==='object'&&['Active','Processing','Failed'].includes(result.status),'ASSET_REVIEW_INVALID_RESPONSE','Reference review returned an invalid status.');
    await emit(result);
    if(result.status==='Failed'||result.compliant===false)throw new MediaError('ASSET_REVIEW_FAILED','Video reference did not pass provider review.',{role,index,asset_id:result.assetId||null,provider_text:sanitizeProviderText(result.reason||result.rawReason||'Reference rejected'),generation_submitted:false,retry_automatically:false});
    requireValue(typeof result.assetId==='string'&&/^[A-Za-z0-9_-]+$/.test(result.assetId),'ASSET_REVIEW_INVALID_RESPONSE','Reference review returned no usable asset ID.');
    const uri=result.assetUri||'asset://'+result.assetId;
    requireValue(assetUri(uri)&&uri==='asset://'+result.assetId,'ASSET_REVIEW_INVALID_RESPONSE','Reference review returned an inconsistent asset URI.');
    const record={owner:META.name,id:key,status:result.status,assetId:result.assetId,assetUri:uri,updated_at:new Date().toISOString()};
    if(saved){await replaceJob(p,record);saved=record;}
    else{try{await createJson(p,record);saved=record;}catch(e){if(e.code!=='EEXIST')throw e;const old=await readJson(p);requireValue(old.owner===META.name&&old.id===key,'UNMANAGED_STATE','Reference review ownership mismatch.');await replaceJob(p,record);saved=record;}}
    if(result.status==='Active')return uri;
    if(Date.now()>=end)throw new MediaError('ASSET_REVIEW_PENDING','Video reference review is still processing; generation was not submitted.',{role,index,asset_id:result.assetId,generation_submitted:false,retry_automatically:false});
    await new Promise(r=>setTimeout(r,Math.min(interval,Math.max(0,end-Date.now()))));
    if(Date.now()>=end)throw new MediaError('ASSET_REVIEW_PENDING','Video reference review is still processing; generation was not submitted.',{role,index,asset_id:result.assetId,generation_submitted:false,retry_automatically:false});
    result=await request(connection.cfg,'/canvas/ark/status',{method:'POST',data:{assetId:result.assetId},timeout:Math.min(20000,end-Date.now())});
  }
}
