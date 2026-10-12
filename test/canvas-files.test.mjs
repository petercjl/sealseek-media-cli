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

test('canvas file CLI: discovery, previews, verified rename/move, backups and uncertain writes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-files-'));
 const state=path.join(dir,'state');
 let board={id:'test-board',title:'Original',folderId:null,folderName:null,content:'{"elements":[{"id":"keep"}]}'};
 let mutations=[],mode='normal';
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  res.setHeader('Content-Type','application/json');
  const send=data=>res.end(JSON.stringify({code:200,data}));
  if(url.pathname.endsWith('/canvas/detail/test-board'))return send(board);
  if(url.pathname.endsWith('/canvas/folder/list'))return send([{id:3,folderName:'Project',canvasCount:2}]);
  if(url.pathname.endsWith('/api/generation-models')){const {CATALOG}=await import('../src/models.mjs');return send({image:CATALOG.models.filter(m=>m.type==='image'),video:CATALOG.models.filter(m=>m.type==='video')});}
  if(url.pathname.endsWith('/canvas/list')){assert.equal(url.searchParams.get('folderId'),'3');return send({records:[board],total:1,current:1,pages:1});}
  const rename=url.pathname.endsWith('/canvas/update');
  const bind=url.pathname.endsWith('/canvas/folder/bind');
  const unbind=url.pathname.endsWith('/canvas/folder/unbind');
  if(rename||bind||unbind){
   const backups=await fs.readdir(path.join(state,'canvases','metadata-backups'));
   assert(backups.length>mutations.length,'backup exists before every mutation');
   const snapshots=await Promise.all(backups.map(async f=>JSON.parse(await fs.readFile(path.join(state,'canvases','metadata-backups',f),'utf8'))));
   assert(snapshots.some(s=>JSON.stringify(s.canvas)===JSON.stringify(board)));
   let raw='';for await(const chunk of req)raw+=chunk;
   const input=raw?JSON.parse(raw):null;
   mutations.push({method:req.method,path:url.pathname,input});
   if(rename){assert.equal(req.method,'PUT');assert.deepEqual(Object.keys(input).sort(),['id','title']);if(mode!=='ignore')board.title=input.title;}
   else {assert.equal(req.method,'GET');assert.equal(url.searchParams.get('canvasId'),'test-board');board.folderId=bind?Number(url.searchParams.get('folderId')):null;board.folderName=bind?'Project':null;}
   if(mode==='disconnect'){req.socket.destroy();return;}
   if(mode==='content-change')board.content='{}';
   return send(true);
  }
  res.writeHead(404);send(null);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config=path.join(dir,'desktop.json');
 await fs.writeFile(config,JSON.stringify({mcp:{servers:{'sealseek-canvas':{url:`http://127.0.0.1:${server.address().port}/mcp`,headers:{Authorization:'Bearer fixture'}}}}}));
 const cli=async args=>JSON.parse((await exec(process.execPath,[path.join(ROOT,'bin/sealseek-media.mjs'),'canvas',...args,'--config',config,'--json'],{env:{...process.env,SEALSEEK_MEDIA_STATE_DIR:state,SEALSEEK_MEDIA_AUTO_UPDATE:'0'}})).stdout);
 const fails=async(args,code)=>assert.rejects(cli(args),e=>{const v=JSON.parse(e.stdout);assert.equal(v.error.code,code);return true;});
 try{
  const folders=await cli(['folders']);assert.equal(folders.projects_are_folders,true);assert.deepEqual(folders.folders,[{folder_id:'3',name:'Project',canvas_count:2}]);
  assert.equal((await cli(['folders','--keyword','Absent'])).count,0);
  assert.equal((await cli(['rename','test-board','--title','Renamed'])).dry_run,true);
  assert.equal((await cli(['move','test-board','--folder','3'])).target.folder_id,'3');assert.equal(mutations.length,0);
  for(const args of [['move','test-board'],['move','test-board','--folder','3','--root'],['move','test-board','--folder','bad'],['rename','test-board','--title','']])await fails(args,'INVALID_INPUT');
  await fails(['move','test-board','--folder','99','--submit'],'FOLDER_NOT_FOUND');assert.equal(mutations.length,0);
  const renamed=await cli(['rename','test-board','--title','Renamed','--submit']);assert.equal(renamed.verified,true);assert.equal(renamed.canvas.title,'Renamed');assert.equal(renamed.canvas.folder_id,null);
  if(process.platform!=='win32')assert.equal((await fs.stat(renamed.backup)).mode&0o777,0o600);
  assert.equal(JSON.parse(await fs.readFile(renamed.backup,'utf8')).canvas.title,'Original');
  assert.equal((await cli(['rename','test-board','--title','Renamed','--submit'])).changed,false);assert.equal(mutations.length,1);
  assert.equal((await cli(['move','test-board','--folder','3','--submit'])).canvas.folder_name,'Project');
  assert.equal((await cli(['move','test-board','--folder','3','--submit'])).changed,false);assert.equal(mutations.length,2);
  assert.equal((await cli(['list','--folder','3'])).canvases[0].folder_id,'3');
  assert.equal((await cli(['move','test-board','--root','--submit'])).canvas.folder_id,null);
  assert.equal(board.content,'{"elements":[{"id":"keep"}]}');
  mode='ignore';await fails(['rename','test-board','--title','Ignored','--submit'],'CANVAS_UPDATE_UNCERTAIN');assert.equal(mutations.length,4);
  mode='disconnect';await assert.rejects(cli(['rename','test-board','--title','Unknown','--submit']),e=>{const error=JSON.parse(e.stdout).error;assert.equal(error.code,'SUBMISSION_UNCERTAIN');assert.equal(error.details.retry_automatically,false);assert(error.details.backup);return true;});assert.equal(mutations.length,5);
  mode='normal';assert.equal((await cli(['rename','test-board','--title','Unknown','--submit'])).changed,false);assert.equal(mutations.length,5);
  delete board.folderId;await fails(['move','test-board','--root','--submit'],'OUTPUT_CONTRACT_FAILED');assert.equal(mutations.length,5);
  board.folderId=null;mode='content-change';await fails(['rename','test-board','--title','Modified','--submit'],'CANVAS_UPDATE_UNCERTAIN');assert.equal(mutations.length,6);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
