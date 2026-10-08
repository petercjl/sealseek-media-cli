import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {generationPayload,generate,pollTask,request,toolsFor,validateNativeInput} from '../src/canvas.mjs';
import {CATALOG,validateModel} from '../src/models.mjs';
import {generationResult,validateVideoOptions} from '../src/media.mjs';

test('native payload preserves reference modes, explicit false audio and quality settings',()=>{
 const args={model:'doubao-seedance-2-0',prompt:'test',aspect_ratio:'1:1',resolution:'720p',duration:4,first_frame_image:'first',last_frame_image:'last',generate_audio:false};
 const p=generationPayload('video',args,{canvasId:'canvas',traceId:'trace'});
 assert.equal(p.firstFrameImage,'first');assert.equal(p.lastFrameImage,'last');assert.equal(p.videoParams.generateAudio,false);assert.equal(p.bgm,false);assert.equal(p.videoParams.duration,'4');
 const tools=toolsFor(CATALOG);
 assert.equal(validateModel('image',{model:'nano-banana-pro'},{tools}).transport.model_field_accepts,true);
 assert.throws(()=>validateModel('video',{model:'doubao-seedance-2-0','quality-mode':'invalid'},{tools}),{code:'FEATURE_UNSUPPORTED'});
 assert.throws(()=>validateModel('image',{model:'gpt-image-2.5-sunburst',size:'1024x1024',resolution:'1K'},{tools}),{code:'FEATURE_UNSUPPORTED'});
 const image=generationPayload('image',{model:'nano-banana-pro',prompt:'test',resolution:'1K'},{canvasId:'canvas',traceId:'trace'});assert.equal(image.imageParams.model,'nano-banana-pro');assert.equal(image.imageParams.resolution,'1K');
});
test('native submission persists remote identity before polling; resume only polls',async()=>{
 let posts=0,reads=0,saved=false;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  let data;
  if(req.url.endsWith('/canvas/create'))data={id:'canvas'};
  else if(req.url.endsWith('/canvas/tasks/generate')){posts++;data={taskId:'remote'};}
  else {reads++;assert(saved,'remote ID must be saved before querying');data={status:'done',images:['https://example.com/result.png']};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const cfg={url:new URL('http://127.0.0.1:'+server.address().port),headers:{}};
 try{
  const c={cfg,tools:toolsFor(CATALOG),onSubmitted:async value=>{assert.equal(value.remote_task_id,'remote');saved=true;}};
  await generate(c,'image',{model:'gpt-image-2.5-sunburst',prompt:'test'},1000);await pollTask(cfg,'remote',{timeout:1000});assert.equal(posts,1);assert.equal(reads,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('native transport uncertainty does not replay POST and sanitizes diagnostics',async()=>{
 let posts=0;
 const server=http.createServer((req,res)=>{posts++;req.socket.destroy();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await assert.rejects(request({url:new URL('http://127.0.0.1:'+server.address().port),headers:{}},'/canvas/tasks/generate',{method:'POST',data:{prompt:'test'},submission:true}),{code:'SUBMISSION_UNCERTAIN'});assert.equal(posts,1);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('result extraction uses generated outputs, excluding echoed reference URLs',()=>{
 const result=generationResult([{images:['https://example.com/result.png'],referenceImages:['https://example.com/reference.png'],billingXidou:2}],{kind:'image',args:{model:'gpt-image-2.5-sunburst'}});
 assert.deepEqual(result.urls,['https://example.com/result.png']);assert.equal(result.cost.amount,2);
});

test('official image operation contracts and audio-reference prerequisites reject before submission',()=>{
 assert.throws(()=>validateNativeInput('QuickEditRunParam',{imageUrl:'https://example.com/input.png',prompt:'edit',model:'seedream-5-0'}),{code:'FEATURE_UNSUPPORTED'});
 assert.throws(()=>validateNativeInput('EditTextParam',{imageUrl:'https://example.com/input.png',oldText:'HELLO',newText:'WELCOME'}),{code:'FEATURE_UNSUPPORTED'});
 validateNativeInput('EditTextParam',{imageUrl:'https://example.com/input.png',model:'nano-banana-pro',edits:[{oldText:'HELLO',newText:'WELCOME',x1:.2,y1:.3,x2:.8,y2:.6}]});
 assert.throws(()=>validateModel('video',{model:'doubao-seedance-2-0','audio-reference':'https://example.com/ref.wav'}),{code:'FEATURE_UNSUPPORTED'});
 validateModel('video',{model:'doubao-seedance-2-0','audio-reference':'https://example.com/ref.wav',reference:['https://example.com/ref.png']});
 validateModel('video',{model:'doubao-seedance-2-5','audio-reference':'https://example.com/ref.wav'});
});

test('advanced video options keep model-specific limits and never override basic fields',()=>{
 assert.throws(()=>validateVideoOptions({model:'other'},{model:'doubao-seedance-2-5'},4),{code:'FEATURE_UNSUPPORTED'});
 assert.throws(()=>validateVideoOptions({videoWebSearch:true},{model:'doubao-seedance-2-0',reference:['image']},4),{code:'FEATURE_UNSUPPORTED'});
 assert.throws(()=>validateVideoOptions({multiShot:true},{model:'doubao-seedance-2-5'},5),{code:'FEATURE_UNSUPPORTED'});
 const extra=validateVideoOptions({omniReferenceTaskType:'reference',outputFormat:'mov'},{model:'doubao-seedance-2-5'},5);
 const p=generationPayload('video',{model:'doubao-seedance-2-5',prompt:'test',duration:5,video_options:extra},{canvasId:'canvas',traceId:'trace'});assert.equal(p.videoParams.outputFormat,'mov');assert.equal(p.videoParams.omniReferenceTaskType,'reference');
});

test('allowlist blocks stale requests and hostile catalogs before any remote mutation',async()=>{
 const removed=['gpt-image-2','nano-banana2','nano-banana2-lite','seedream-5-0','seedream-5-0-lite','doubao-seedance-2-0-fast','doubao-seedance-2-0-mini','wan3.0-video','minimax-h3','kling-v3','kling-v3-omni','happyhorse-t2v','happyhorse-i2v','happyhorse-r2v'];
 for(const model of removed){assert.throws(()=>validateModel('image',{model}),{code:'MODEL_UNAVAILABLE'});await assert.rejects(generate({tools:[]},'image',{model,prompt:'blocked'},1000),{code:'MODEL_UNAVAILABLE'});}
 const injected={...CATALOG,models:[...CATALOG.models,{...CATALOG.models[0],id:'unapproved-new-model'}]};
 assert(!toolsFor(injected)[0].inputSchema.properties.model.enum.includes('unapproved-new-model'));
});
