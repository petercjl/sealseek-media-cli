import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),config=pkg.skillLifecycle;
const baseline={'sealseek-media':'0.6.8','cloud-hug-style-transfer':'0.5.0','nano-product-replacement':'0.2.1'}[config.skill];
const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'archived-updater-'))),npm=process.env.npm_execpath;
assert(npm&&fs.existsSync(npm),'Run through npm run verify:historical.');
const env={...process.env,[config.env+'_AUTO_UPDATE']:'0',[config.env+'_STATE_DIR']:path.join(dir,'state'),npm_config_dry_run:'false',npm_config_json:'false',npm_config_fetch_retries:'0',npm_config_fetch_timeout:'15000',npm_config_prefer_offline:'true'};
const run=(entry,args,extra={})=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[entry,...args],{cwd:root,env:{...env,...extra},windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('Historical test timed out: '+args.slice(0,2).join(' ')));},180000);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(Error('Historical command failed: '+code+' '+stdout+' '+stderr));});});
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let server;
try {
 const packedResult=JSON.parse(await run(npm,['pack','--ignore-scripts','--json','--pack-destination',dir]));const packed=Array.isArray(packedResult)?packedResult[0]:packedResult[pkg.name];
 const tarball=path.join(dir,packed.filename),prefix=path.join(dir,'old-global');
 await run(npm,['install','--global','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund',pkg.name+'@'+baseline]);
 const modules=(await run(npm,['root','--global','--prefix',prefix])).trim(),oldRoot=path.join(modules,...pkg.name.split('/')),oldEntry=path.join(oldRoot,config.entry);
 const oldVersionOutput=await run(oldEntry,['version','--json']);let actualVersion;try{actualVersion=JSON.parse(oldVersionOutput).version;}catch{actualVersion=oldVersionOutput.trim().match(/(?:^| )(\d+\.\d+\.\d+)$/)?.[1];}assert.equal(actualVersion,baseline);
 const originalEntryHash=digest(oldEntry),oldSkill=fs.readFileSync(path.join(oldRoot,'skills',config.skill,'SKILL.md')),oldUpdaterHashes={};
 for(const name of ['src/update.mjs','npm/update.mjs','src/lifecycle.mjs'])if(fs.existsSync(path.join(oldRoot,name)))oldUpdaterHashes[name]=digest(path.join(oldRoot,name));
 const parent=path.join(dir,'selected'),target=path.join(parent,config.skill);
 const initial=config.skill==='cloud-hug-style-transfer'?['skill','install','--agent','codex','--root',parent,'--json']:config.skill==='nano-product-replacement'?['skill','install','--agent','generic','--target-directory',target,'--mode','link','--json']:['skill','install','--agent','future-agent','--path',target,'--json'];
 await run(oldEntry,initial);assert.deepEqual(fs.readFileSync(path.join(target,'SKILL.md')),oldSkill);
 let route,legacyReceipt;
 if(config.skill==='nano-product-replacement') {
  // The published parent scans named hosts before handoff. Its safe supported path is explicit bootstrap migration.
  const bootstrap=path.join(dir,'candidate-bootstrap');await run(npm,['install','--prefix',bootstrap,'--ignore-scripts','--no-audit','--no-fund',tarball]);
  const entry=path.join(bootstrap,'node_modules',...pkg.name.split('/'),config.entry);
  legacyReceipt=JSON.parse(await run(entry,['skill','update','--agent','future-agent','--path',target,'--legacy-source',oldRoot,'--mode','link','--json']));
  assert(legacyReceipt.backup);assert.deepEqual(fs.readFileSync(path.join(legacyReceipt.backup,'SKILL.md')),oldSkill);
  route='explicit migration through new bootstrap; published cross-host updater excluded';
 }else{
  let base;
  server=http.createServer(async(req,res)=>{
   try{
    const url=new URL(req.url,base),decoded=decodeURIComponent(url.pathname);
    if(decoded==='/candidate.tgz'){res.setHeader('Content-Type','application/octet-stream');fs.createReadStream(tarball).pipe(res);return;}
    if(decoded==='/'+pkg.name||decoded==='/'+pkg.name+'/latest'){
     const version={...pkg,dist:{tarball:base+'/candidate.tgz',shasum:crypto.createHash('sha1').update(fs.readFileSync(tarball)).digest('hex')}};
     const value=decoded.endsWith('/latest')?version:{name:pkg.name,'dist-tags':{latest:pkg.version},versions:{[pkg.version]:version}};
     res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;
    }
    const upstream=await fetch('https://registry.npmjs.org'+req.url,{signal:AbortSignal.timeout(15000)});res.statusCode=upstream.status;res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');res.end(Buffer.from(await upstream.arrayBuffer()));
   }catch{res.statusCode=502;res.end('fixture upstream unavailable');}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  const preload=path.join(dir,'candidate-selection.mjs');
  fs.writeFileSync(preload,`const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);if(url.hostname==='registry.npmjs.org'&&decodeURIComponent(url.pathname).startsWith('/'+${JSON.stringify(pkg.name)}))return original(${JSON.stringify(base)}+url.pathname+url.search,init);return original(input,init);};`,{flag:'wx'});
  // Only candidate selection changes; published updater bytes and real npm remain unmodified.
  const extra={npm_config_prefix:prefix,npm_config_registry:base,NODE_OPTIONS:(process.env.NODE_OPTIONS||'')+' --import '+JSON.stringify(pathToFileURL(preload).href)};
  delete extra[config.env+'_AUTO_UPDATE'];
  const updateArgs=config.skill==='cloud-hug-style-transfer'?['update','install','--yes','--agent','codex','--root',parent,'--json']:['update','install','--yes','--agent','future-agent','--path',target,'--json'];
  const result=await run(oldEntry,updateArgs,extra);legacyReceipt=JSON.parse(result);
  assert.equal(legacyReceipt.version,pkg.version);route='unmodified archived updater with real npm and controlled candidate registry';
  const backup=legacyReceipt.backup;if(backup&&fs.statSync(backup).isDirectory())assert.equal(JSON.parse(fs.readFileSync(path.join(backup,'package.json'))).version,baseline);
 }
 const local=path.join(target,'scripts/run.mjs');assert.equal(fs.lstatSync(target).isSymbolicLink(),false);
 assert.equal(JSON.parse(await run(local,['version'])).version,pkg.version);
 assert.equal(JSON.parse(await run(local,['skill','status','--path',target])).current,true);
 const repeat=JSON.parse(await run(local,['update','install','--yes','--version',pkg.version,'--path',target]));assert.equal(repeat.changed,false);
 console.log(JSON.stringify({ok:true,package:pkg.name,from:baseline,to:pkg.version,archivedEntryHash:originalEntryHash,archivedUpdaterHashes:oldUpdaterHashes,route,realNpm:true,historicalMode:config.skill==='nano-product-replacement'?'link-to-copy':'copy',sameVersionNoop:true,hostDiscovery:'not-attested',platform:process.platform},null,2));
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(dir,{recursive:true,force:true});}
