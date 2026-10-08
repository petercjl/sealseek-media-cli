import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CATALOG,modelContract,validateModel,validateCatalog } from '../src/models.mjs';
import { unwrap,call } from '../src/mcp.mjs';
import { prepare } from '../src/media.mjs';
import { inspectFile } from '../src/diagnostics.mjs';
import { hash } from '../src/core.mjs';
const props={prompt:{type:'string'},model:{type:'string'},duration:{type:'integer'},aspect_ratio:{type:'string'},resolution:{type:'string'},num:{type:'integer'},reference_images:{type:'array',items:{type:'string'}},first_frame_image:{type:'string'},last_frame_image:{type:'string'}};
const tools=['image','video'].map(type=>({name:`generate_${type}`,inputSchema:{type:'object',properties:props,required:['model','prompt']}}));

test('all provider-catalog choices validate and unsupported values fail for all 19 models',()=>{
 assert.equal(CATALOG.models.length,19);
 for(const m of CATALOG.models){
  const base={model:m.id,...(m.id==='happyhorse-i2v'?{first:'https://example.com/ref.png'}:{}),...(m.id==='happyhorse-r2v'?{reference:['https://example.com/ref.png']}: {})};
  for(const resolution of m.resolutions)for(const ratio of m.capabilities.aspectRatios)for(const duration of m.capabilities.durations||[undefined])assert.equal(validateModel(m.type,{...base,resolution,ratio,duration},{tools}).model,m.id);
  for(const invalid of [{ratio:'2:7'},{resolution:'invalid'},...(m.type==='video'?[{duration:1},{duration:31}]:[])])assert.throws(()=>validateModel(m.type,{...base,...invalid},{tools}),{code:'FEATURE_UNSUPPORTED'});
  if(m.capabilities.supportsReference){const refs=Array(m.capabilities.maxReferences).fill('https://example.com/ref.png');assert.equal(validateModel(m.type,{...base,reference:refs},{tools}).model,m.id);assert.throws(()=>validateModel(m.type,{...base,reference:[...refs,'https://example.com/extra.png']},{tools}),{code:'FEATURE_UNSUPPORTED'});}
 }
 assert.throws(()=>validateCatalog({image:[{id:'broken'}]}),{code:'OUTPUT_CONTRACT_FAILED'});
});
test('transport contracts distinguish model support from MCP input exposure',()=>{
 const narrow=[{name:'generate_image',inputSchema:{properties:{model:{enum:['gpt-image-2']},reference_images:{}}}}];
 assert.equal(modelContract('nano-banana2',{tools:narrow}).transport.model_advertised,false);
 assert.throws(()=>validateModel('image',{model:'nano-banana2'},{tools:narrow}),{code:'FEATURE_UNSUPPORTED'});
 const c=modelContract('kling-v3',{tools});assert.equal(c.capabilities.quality_modes.transport_support,false);assert.deepEqual(c.capabilities.quality_modes.values,['std','pro']);
 assert.equal(modelContract('doubao-seedance-2-5').capabilities.first_frame.model_support,false);
});
test('invalid reference mode rejects before reference IO, upload or submission',async()=>{
 for(const flag of ['first','last'])await assert.rejects(prepare('video',{model:'doubao-seedance-2-5',prompt:'test',[flag]:'/file/that/does/not/exist'},tools),{code:'FEATURE_UNSUPPORTED'});
 await assert.rejects(prepare('video',{model:'kling-v3',prompt:'test',reference:['/absent']},tools),{code:'FEATURE_UNSUPPORTED'});
 await assert.rejects(prepare('video',{model:'happyhorse-i2v',prompt:'test'},tools),{code:'INVALID_INPUT'});
 await assert.rejects(prepare('video',{model:'happyhorse-r2v',prompt:'test'},tools),{code:'INVALID_INPUT'});
 await assert.rejects(prepare('video',{model:'doubao-seedance-2-0-fast',prompt:'test',count:1},tools),{code:'FEATURE_UNSUPPORTED'});
 const request=await prepare('video',{model:'wan3.0-video',prompt:'test',duration:2},tools);assert.equal(request.args.duration,2);
 const image=await prepare('image',{model:'gpt-image-2',prompt:'test',resolution:'4K'},tools);assert.equal(image.args.resolution,'4K');
});
test('sanitized provider parameter errors preserve actionable constraint and remove credentials',()=>{
 try{unwrap({isError:true,content:[{type:'text',text:'参数配置不符合任务类型约束，比例必须为adaptive；token=private-token-value Bearer bearer-secret https://secret.example/token?key=secret'}]});assert.fail('must throw');}catch(e){assert.equal(e.code,'PROVIDER_PARAMETER_REJECTED');assert.match(e.details.provider_text,/adaptive/);assert(!/private-token-value|bearer-secret|secret.example/.test(e.details.provider_text));assert.equal(e.details.retry_automatically,false);}
});
test('transport interruption keeps uncertainty and sanitized diagnostic without replay',async()=>{
 let attempts=0;const connection={tools,client:{callTool:async()=>{attempts++;const e=new Error('token=private-value connection ended');e.code=-32000;throw e;}}};
 await assert.rejects(call(connection,'generate_video',{model:'doubao-seedance-2-0-fast',prompt:'test'}),e=>e.code==='SUBMISSION_UNCERTAIN'&&e.details.transport_code===-32000&&!e.details.transport_error.includes('private-value')&&e.details.retry_automatically===false);
 assert.equal(attempts,1);
});
test('artifact inspection verifies hash and reports rounded dimensions or missing ffprobe',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-inspection-')),file=path.join(dir,'video.mp4'),bytes=Buffer.from('fixture');await fs.writeFile(file,bytes,{flag:'wx'});const artifact={path:file,size:bytes.length,sha256:hash(bytes)};
 try{
  const r=await inspectFile(artifact,{probe:()=>({status:0,stdout:JSON.stringify({streams:[{width:560,height:752,r_frame_rate:'24/1',duration:'4.041667'}],format:{duration:'4.096'}})})});assert.equal(r.pixel_ratio,'35:47');assert.equal(r.video_duration_seconds,4.041667);
  const missing=await inspectFile(artifact,{probe:()=>({error:{code:'ENOENT'}})});assert.equal(missing.error.code,'INSPECTION_UNAVAILABLE');
  await assert.rejects(inspectFile({...artifact,sha256:'wrong'}),{code:'ARTIFACT_CHANGED'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
