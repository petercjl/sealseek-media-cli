import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, publicError, parse } from '../src/core.mjs';
import { prepare, mediaUrls, reference, signedUploadUrl } from '../src/media.mjs';
const exec = promisify(execFile);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bqUAAAAASUVORK5CYII=','base64');
const tools=[{name:'generate_image',inputSchema:{type:'object',properties:{prompt:{type:'string'},model:{type:'string',enum:['gpt-image-2.5-flare']},num:{type:'integer'},aspect_ratio:{type:'string'},resolution:{type:'string'},reference_images:{type:'array',items:{type:'string'}}},required:['prompt','model']}},{name:'generate_video',inputSchema:{type:'object',properties:{prompt:{type:'string'},model:{type:'string'},duration:{type:'integer'},aspect_ratio:{type:'string'},resolution:{type:'string'}},required:['prompt','model']}},{name:'create_upload_urls',inputSchema:{type:'object',properties:{files:{type:'array'}}}},{name:'list_artifacts',inputSchema:{type:'object',properties:{pageNum:{type:'integer'},pageSize:{type:'integer'},type:{type:'string'}}}}];

test('strict parser and safe public errors',()=>{
 assert.throws(()=>parse(['--mystery'],[]),{code:'UNKNOWN_OPTION'});
 assert.throws(()=>parse(['--model','--json'],['model','json']),{code:'INVALID_INPUT'});
 assert(!JSON.stringify(publicError(new Error('Bearer secret-value'))).includes('secret-value'));
});
test('legacy signed OSS upload upgrades to HTTPS and preserves signature bytes',()=>{
 const tail='//bucket.oss-cn-hangzhou.aliyuncs.com/folder/ref.png?Signature=a%2Bb%2Fc%3D&Expires=123';
 assert.equal(signedUploadUrl('http:'+tail),'https:'+tail);
 assert.equal(signedUploadUrl('https:'+tail),'https:'+tail);
 assert.equal(signedUploadUrl('http://127.0.0.1:1234/upload'),'http://127.0.0.1:1234/upload');
 assert.throws(()=>signedUploadUrl('http://example.com/upload'),{code:'INVALID_URL'});
 assert.throws(()=>signedUploadUrl('http://bucket.oss-cn-hangzhou.aliyuncs.com.evil.example/upload'),{code:'INVALID_URL'});
 assert.throws(()=>signedUploadUrl('https://user:pass@bucket.oss-cn-hangzhou.aliyuncs.com/upload'),{code:'INVALID_URL'});
});
test('schema mismatch rejects rather than dropping requested fields',async()=>{
 await assert.rejects(prepare('image',{prompt:'杯子',model:'bad-model'},tools),{code:'MODEL_UNAVAILABLE'});
 await assert.rejects(prepare('image',{prompt:'杯子',model:'gpt-image-2.5-flare',count:'5'},tools),{code:'FEATURE_UNSUPPORTED'});
 await assert.rejects(prepare('video',{prompt:'cup',model:'doubao-seedance-2-5',duration:20,resolution:'2k'},tools),{code:'FEATURE_UNSUPPORTED'});
 assert.deepEqual(mediaUrls([{url:'https://example.com/cup.png',reference:'not-url'}],'image'),['https://example.com/cup.png']);
});
test('real CLI transport: dry-run, opt-in, upload, worker output, deduplication and file protection',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-media-test-'));
 let generations=0,uploads=0,port;
 const server=http.createServer(async(req,res)=>{
  if(req.method==='GET' && req.url==='/api/sealseek-infinitecanvas/api/generation-models'){const {CATALOG}=await import('../src/models.mjs');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({code:200,data:{image:CATALOG.models.filter(m=>m.type==='image'),video:CATALOG.models.filter(m=>m.type==='video')}}));return;}
  if(req.method==='GET' && req.url==='/asset.png'){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}
  if(req.method==='PUT'){uploads++;res.end();return;}
  let raw='';for await(const part of req)raw+=part;
  if(!raw){res.writeHead(405);res.end();return;}
  const rpc=JSON.parse(raw);
  if(!('id' in rpc)){res.writeHead(202);res.end();return;}
  let result;
  if(rpc.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  else if(rpc.method==='tools/list')result={tools};
  else if(rpc.method==='tools/call'){
   if(rpc.params.name==='create_upload_urls') result={content:[{type:'text',text:JSON.stringify([{upload_url:`http://127.0.0.1:${port}/upload`,file_url:`http://127.0.0.1:${port}/asset.png`,headers:{'Content-Type':'image/png'}}])}]};
   else {generations++;result=rpc.params.arguments.prompt==='reject'?{isError:true,content:[{type:'text',text:'参数配置不符合任务类型约束：比例必须为 adaptive。token=private-fixture-secret'}]}:{content:[{type:'text',text:JSON.stringify({images:[`http://127.0.0.1:${port}/asset.png`]})}]};}
  }else result={};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
 const config=path.join(dir,'desktop.json');await fs.writeFile(config,JSON.stringify({mcp:{servers:{'sealseek-canvas':{url:`http://127.0.0.1:${port}/mcp`,headers:{Authorization:'Bearer fixture'}}}}}));
 const env={...process.env,SEALSEEK_MEDIA_STATE_DIR:path.join(dir,'state'),SEALSEEK_MEDIA_DESKTOP_CONFIG:config};
 const cli=async args=>JSON.parse((await exec(process.execPath,[path.join(ROOT,'bin/sealseek-media.mjs'),...args],{env})).stdout);
 try{
  const file=path.join(dir,'参考图.png');await fs.writeFile(file,png);
  const base=['image','generate','--prompt','测试红杯','--model','gpt-image-2.5-flare','--reference',file,'--output',path.join(dir,'out'),'--json'];
  const dry=await cli(base);assert.equal(dry.dry_run,true);assert.equal(generations,0);assert.equal(uploads,0);
  await assert.rejects(cli([...base,'--submit','--dry-run']));assert.equal(generations,0);
  const job=await cli([...base,'--submit']);assert.equal(job.status,'queued');
  let done;for(let i=0;i<30;i++){done=await cli(['task','get',job.task_id]);if(done.status==='succeeded')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(done.status,'succeeded');assert.equal(generations,1);assert.equal(uploads,1);assert.equal(done.artifacts[0].size,png.length);
  const permissions=(await fs.stat(path.join(dir,'state/jobs',`${job.task_id}.json`))).mode&0o777;if(process.platform!=='win32')assert.equal(permissions,0o600);
  const duplicate=await cli([...base,'--submit','--via','sealseek']);assert.equal(duplicate.task_id,job.task_id);assert.equal(duplicate.deduplicated,true);assert.equal(generations,1);
  await assert.rejects(cli(['image','upload',file]));assert.equal(uploads,1);
  const uploaded=await cli(['image','upload',file,'--submit']);assert(uploaded.url);assert.equal(uploads,2);assert.equal(generations,1);
  await assert.rejects(cli(['task','download',job.task_id,'--output',path.join(dir,'out')]));assert.deepEqual(await fs.readFile(done.artifacts[0].path),png);
  await assert.rejects(cli(['task','get','../../credentials']));
  const bad=path.join(dir,'bad.png');await fs.writeFile(bad,'not an image');await assert.rejects(reference(bad),{code:'INVALID_REFERENCE'});
  const rejected=await cli(['image','generate','--model','gpt-image-2.5-flare','--prompt','reject','--submit']);const failed=await cli(['task','wait',rejected.task_id,'--timeout','5']);assert.equal(failed.status,'failed');assert.equal(failed.error.code,'PROVIDER_PARAMETER_REJECTED');
  const diagnosis=await cli(['task','diagnose',rejected.task_id]);assert.equal(diagnosis.provider_error_available,true);assert.match(diagnosis.provider_error.details.provider_text,/adaptive/);assert(!JSON.stringify(diagnosis).includes('private-fixture-secret'));assert.equal(generations,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
