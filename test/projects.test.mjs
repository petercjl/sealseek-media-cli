import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from '../src/core.mjs';
const exec=promisify(execFile);

test('project CLI creates and renames, verifies, deduplicates and preserves uncertain creation intent',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-projects-')),state=path.join(dir,'state');
 const folders=[{id:3,folderName:'Original',canvasCount:4}];let posts=[],mode='normal';
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');res.setHeader('Content-Type','application/json');
  const send=data=>res.end(JSON.stringify({code:200,data}));
  if(url.pathname==='/api/user/user/info')return send({userUuid:'fixture'});
  if(url.pathname.endsWith('/canvas/folder/list'))return send(folders);
  let raw='';for await(const c of req)raw+=c;
  if(req.method==='POST'){
   const input=JSON.parse(raw);posts.push({path:url.pathname,input});
   if(url.pathname.endsWith('/canvas/folder/create')){
    assert.deepEqual(Object.keys(input),['folderName']);
    const records=await fs.readdir(path.join(state,'projects','requests'));assert(records.length>0);
    const id=folders.length+10;folders.push({id,folderName:input.folderName,canvasCount:0});
    if(mode==='disconnect'){req.socket.destroy();return;}
    if(mode==='bad-id')return send(null);
    return send(id);
   }
   if(url.pathname.endsWith('/canvas/folder/update')){
    assert.deepEqual(Object.keys(input).sort(),['folderName','id']);
    const backups=await fs.readdir(path.join(state,'projects','metadata-backups'));assert(backups.length>0);
    if(mode!=='ignore')folders.find(f=>f.id===input.id).folderName=input.folderName;
    return send(true);
   }
  }
  res.writeHead(404);send(null);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config=path.join(dir,'config.json');await fs.writeFile(config,JSON.stringify({mcp:{servers:{'sealseek-canvas':{url:`http://127.0.0.1:${server.address().port}/mcp`,headers:{Authorization:'Bearer fixture'}}}}}));
 const cli=async args=>JSON.parse((await exec(process.execPath,[path.join(ROOT,'bin/sealseek-media.mjs'),'project',...args,'--config',config,'--json'],{env:{...process.env,SEALSEEK_MEDIA_STATE_DIR:state,SEALSEEK_MEDIA_AUTO_UPDATE:'0'}})).stdout);
 const fails=async(args,code)=>assert.rejects(cli(args),e=>{assert.equal(JSON.parse(e.stdout).error.code,code);return true;});
 try{
  assert.equal((await cli(['list'])).folders[0].name,'Original');
  assert.equal((await cli(['list','--keyword','absent'])).count,0);
  const base=['create','--name','新项目','--request-id','new-project'];
  assert.equal((await cli(base)).dry_run,true);assert.equal(posts.length,0);
  await assert.rejects(fs.stat(path.join(state,'projects','requests')),{code:'ENOENT'});
  for(const args of [['create','--name','Missing key'],['create','--name','','--request-id','x'],['create','--name','a'.repeat(21),'--request-id','x'],['rename','3','--name',' '],['rename','bad','--name','New']])await fails(args,'INVALID_INPUT');
  await fails(['rename','99','--name','Missing','--submit'],'FOLDER_NOT_FOUND');assert.equal(posts.length,0);
  const created=await cli([...base,'--submit']);assert(created.verified);assert.equal(created.project.name,'新项目');assert.equal(created.project.folder_id,'11');assert.equal(posts.length,1);
  if(process.platform!=='win32')assert.equal((await fs.stat(created.record)).mode&0o777,0o600);
  assert.equal((await cli([...base,'--submit'])).deduplicated,true);assert.equal(posts.length,1);
  await fails(['create','--name','Other','--request-id','new-project','--submit'],'IDEMPOTENCY_CONFLICT');
  assert.equal((await cli(['rename','3','--name','重命名'])).dry_run,true);assert.equal(posts.length,1);
  const renamed=await cli(['rename','3','--name','重命名','--submit']);assert(renamed.verified);assert.equal(renamed.project.canvas_count,4);assert.equal(JSON.parse(await fs.readFile(renamed.backup,'utf8')).project.name,'Original');
  if(process.platform!=='win32')assert.equal((await fs.stat(renamed.backup)).mode&0o777,0o600);
  assert.equal((await cli(['rename','3','--name','重命名','--submit'])).changed,false);assert.equal(posts.length,2);
  mode='ignore';await fails(['rename','3','--name','Ignored','--submit'],'PROJECT_UPDATE_UNCERTAIN');assert.equal(posts.length,3);
  mode='disconnect';const uncertain=['create','--name','Uncertain','--request-id','uncertain','--submit'];
  await assert.rejects(cli(uncertain),e=>{const v=JSON.parse(e.stdout).error;assert.equal(v.code,'SUBMISSION_UNCERTAIN');assert(v.details.record);assert.equal(v.details.retry_automatically,false);return true;});
  const count=posts.length;mode='normal';await fails(uncertain,'SUBMISSION_UNCERTAIN');assert.equal(posts.length,count);
  mode='bad-id';const invalid=['create','--name','Bad response','--request-id','bad-response','--submit'];await fails(invalid,'SUBMISSION_UNCERTAIN');const badCount=posts.length;await fails(invalid,'SUBMISSION_UNCERTAIN');assert.equal(posts.length,badCount);
  // A confirmed remote identity survives later verification failure; no replacement is created.
  mode='normal';folders.splice(folders.findIndex(f=>f.id===11),1);await fails([...base,'--submit'],'FOLDER_NOT_FOUND');assert.equal(posts.length,badCount);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
