import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),config=pkg.skillLifecycle;
const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'packed-isolation-')));
const env={...process.env,[config.env+'_AUTO_UPDATE']:'0',[config.env+'_STATE_DIR']:path.join(dir,'state'),npm_config_dry_run:'false',npm_config_json:'false',npm_config_fetch_retries:'0',npm_config_fetch_timeout:'15000',npm_config_prefer_offline:'true'};
process.env[config.env+'_STATE_DIR']=path.join(dir,'state');process.env.npm_config_fetch_retries='0';process.env.npm_config_fetch_timeout='15000';process.env.npm_config_prefer_offline='true';
const npm=process.env.npm_execpath;
assert(npm&&fs.existsSync(npm),'Run through npm run verify:packed to resolve the real npm entry.');
const invoke=(entry,args,expected=0,extraEnv={})=>{const r=spawnSync(process.execPath,[entry,...args],{cwd:root,env:{...env,...extraEnv},encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});assert.equal(r.status,expected,r.stderr+r.stdout);return r.stdout;};
const body=(entry,args,expected=0)=>JSON.parse(invoke(entry,args,expected));
try {
 const receipt=JSON.parse(invoke(npm,['pack','--ignore-scripts','--json','--pack-destination',dir]));
 const packed=Array.isArray(receipt)?receipt[0]:receipt[pkg.name];assert(packed?.filename);
 for(const file of packed.files)assert(!/^(test|dev|scripts|\.git|outputs)\//.test(file.path),file.path);
 for(const file of ['INSTALL.md','UPDATE.md','release-integrity.json','lifecycle/engine.mjs'])assert(packed.files.some(f=>f.path===file),file);
 const tarball=path.join(dir,packed.filename),prefix=path.join(dir,'bootstrap');
 invoke(npm,['install','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund',tarball]);
 const packageRoot=path.join(prefix,'node_modules',...pkg.name.split('/')),entry=path.join(packageRoot,config.entry);
 assert.equal(body(entry,['version']).version,pkg.version);
 assert.equal(body(entry,['skill','install','--agent','future-agent','--json'],1).code,'TARGET_PATH_REQUIRED');
 const a=path.join(dir,'agent-a',config.skill),b=path.join(dir,'agent-b',config.skill);
 for(const target of [a,b]){
  const result=body(entry,['skill','install','--agent','future-agent','--path',target,'--json']);assert(result.current);assert.equal(result.hostDiscovery,'pending');
  assert.equal(body(entry,['skill','update','--agent','future-agent','--path',target,'--json']).changed,false);
  assert(!fs.lstatSync(target).isSymbolicLink());assert.notEqual(fs.statSync(path.join(target,'SKILL.md')).ino,fs.statSync(path.join(packageRoot,'skills',config.skill,'SKILL.md')).ino);
 }
 const discovered=body(entry,['skill','source','--json']);assert.equal(discovered.name,config.skill);assert.equal(discovered.maintenanceContract.schemaVersion,1);assert.equal(discovered.maintenanceContract.targetOptions['--root'].kind,'skill-parent');
 const unchanged=lifeSnapshot=>JSON.stringify(lifeSnapshot);
 const readTree=dir=>{const out={};for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out[e.name]=readTree(f);else out[e.name]=[fs.statSync(f).mtimeMs,fs.readFileSync(f).toString('base64')];}return out;};
 const beforeReadOnly=unchanged(readTree(a));
 for(const args of [['--target-directory',a],['--root',path.dirname(a)]]){const receipt=body(entry,['skill','status','--agent','future-agent',...args,'--json']);assert.equal(receipt.target,a);assert.equal(receipt.up_to_date,true);assert.equal(receipt.edited,false);assert.deepEqual(receipt.editedFiles,[]);assert.equal(receipt.verification.verified,true);assert.equal(receipt.complete,false);assert.equal(receipt.recovery.action,'host-discovery');}
 assert.equal(unchanged(readTree(a)),beforeReadOnly);
 const ownedSkill=path.join(a,'SKILL.md'),ownedBytes=fs.readFileSync(ownedSkill);fs.appendFileSync(ownedSkill,'\nprivate local edit\n');
 assert.equal(body(entry,['update','install','--yes','--path',a,'--candidate',tarball,'--json'],1).code,'LOCAL_EDITS');fs.writeFileSync(ownedSkill,ownedBytes);
 // Real-npm candidate acquisition, partial failure, unknown outcome, repeated recovery and rollback.
 const life=await import(pathToFileURL(path.join(packageRoot,'lifecycle/engine.mjs')).href),selected=life.resolveTarget({path:b});
 const beforeOther=life.inventory(a),receiptFile=path.join(b,'.agent-package.json'),stale=JSON.parse(fs.readFileSync(receiptFile));stale.version='0.0.0';fs.writeFileSync(receiptFile,JSON.stringify(stale));
 const originalRename=fs.renameSync;const inject=()=>{fs.renameSync=(from,to)=>{if(path.basename(from)==='staged')throw Object.assign(Error('injected activation failure'),{code:'EIO'});return originalRename(from,to);};};
 inject();try{assert.throws(()=>life.update(selected,{candidate:tarball,yes:true}));}finally{fs.renameSync=originalRename;}
 const partial=life.operationStatus(selected);assert.equal(partial.stage,'failed');assert.equal(partial.packageComplete,true);assert.equal(partial.skillComplete,false);assert(partial.backup);assert(fs.existsSync(path.join(partial.backup,'SKILL.md')));
 assert.throws(()=>life.update(selected,{candidate:tarball,yes:true}),{code:'RECOVERY_REQUIRED'});
 const candidateManifest=path.join(partial.candidate,'release-integrity.json'),candidateBytes=fs.readFileSync(candidateManifest),altered=JSON.parse(candidateBytes);altered.fixture='changed candidate';fs.writeFileSync(candidateManifest,JSON.stringify(altered));assert.throws(()=>life.resume(selected,partial.id,{yes:true}),{code:'CANDIDATE_IDENTITY_MISMATCH'});fs.writeFileSync(candidateManifest,candidateBytes);
 inject();try{assert.throws(()=>life.resume(selected,partial.id,{yes:true}));}finally{fs.renameSync=originalRename;}
 assert.equal(life.operationStatus(selected).id,partial.id);assert.equal(life.operationStatus(selected).backup,partial.backup);
 const resumed=life.resume(selected,partial.id,{yes:true});assert(resumed.ok);assert.equal(life.resume(selected,partial.id,{yes:true}).changed,false);
 assert.deepEqual(life.inventory(a),beforeOther);
 const acquired=life.operationStatus(selected);fs.renameSync(acquired.candidate,acquired.candidate+'-removed-after-activation');const recordFiles=fs.readdirSync(acquired.operationDirectory).filter(x=>/^\d+-.*\.json$/.test(x)).sort(),last=JSON.parse(fs.readFileSync(path.join(acquired.operationDirectory,recordFiles.at(-1))));last.stage='failed';last.error={code:'UNKNOWN_RESULT'};fs.writeFileSync(path.join(acquired.operationDirectory,String(recordFiles.length).padStart(3,'0')+'-unknown-result.json'),JSON.stringify(last),{flag:'wx'});assert.equal(life.resume(selected,partial.id,{yes:true}).changed,false);assert.equal(life.operationStatus(selected).stage,'complete');
 fs.renameSync=(from,to)=>{if(path.basename(from).startsWith('rollback-staged-'))throw Object.assign(Error('injected rollback failure'),{code:'EIO'});return originalRename(from,to);};try{assert.throws(()=>life.rollback(selected,partial.id,{yes:true}));}finally{fs.renameSync=originalRename;}assert.equal(life.operationStatus(selected).stage,'rollback-failed');
 const rolled=life.rollback(selected,partial.id,{yes:true});assert.equal(rolled.stage,'rolled-back');assert.equal(JSON.parse(fs.readFileSync(receiptFile)).version,'0.0.0');life.install(selected);
 const failureMarker=path.join(dir,'fail-acquisition-once'),failurePreload=path.join(dir,'fail-acquisition-once.mjs');fs.writeFileSync(failureMarker,'pending',{flag:'wx'});
 fs.writeFileSync(failurePreload,`import fs from 'node:fs';if(process.argv[1]?.endsWith('npm-cli.js')&&process.argv.includes('install')&&fs.existsSync(${JSON.stringify(failureMarker)})){fs.unlinkSync(${JSON.stringify(failureMarker)});process.exit(86);}`,{flag:'wx'});
 const savedOptions=process.env.NODE_OPTIONS;process.env.NODE_OPTIONS=(savedOptions||'')+' --import '+JSON.stringify(pathToFileURL(failurePreload).href);
 let acquisition;
 try{assert.throws(()=>life.update(selected,{candidate:tarball,yes:true}),{code:'PACKAGE_ACQUISITION_FAILED'});acquisition=life.operationStatus(selected);assert.equal(acquisition.packageComplete,false);assert.equal(life.resume(selected,acquisition.id,{yes:true}).ok,true);assert.equal(life.operationStatus(selected).id,acquisition.id);assert.equal(life.resume(selected,acquisition.id,{yes:true}).changed,false);}
 finally{if(savedOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=savedOptions;}
 const survivor=path.join(b,'scripts/run.mjs');
 // Runtime identity drift must fail read-only prepack validation after a release bump.
 const runtime=path.join(b,'.runtime'),identityFile=path.join(runtime,'package.json'),original=fs.readFileSync(identityFile),identity=JSON.parse(original);identity.version='99.0.0';fs.writeFileSync(identityFile,JSON.stringify(identity));
 const drift=spawnSync(process.execPath,[path.join(runtime,'lifecycle/validate-release.mjs')],{env,encoding:'utf8'});assert.notEqual(drift.status,0);fs.writeFileSync(identityFile,original);
 const extra=path.join(runtime,'lifecycle','untracked-fixture.txt');fs.writeFileSync(extra,'untracked',{flag:'wx'});try{const extraDrift=spawnSync(process.execPath,[path.join(runtime,'lifecycle/validate-release.mjs')],{env,encoding:'utf8'});assert.notEqual(extraDrift.status,0);}finally{fs.unlinkSync(extra);}
 // Remove both bootstrap and another host before executing a real operation in the survivor.
 fs.rmSync(prefix,{recursive:true});fs.rmSync(path.dirname(a),{recursive:true});
 assert.equal(body(survivor,['version']).version,pkg.version);
 assert.equal(body(survivor,['skill','status','--path',b]).runtimeCurrent,true);
 const hits=path.join(dir,'registry-hits.txt'),preload=path.join(dir,'automatic-entry.mjs');fs.writeFileSync(hits,'',{flag:'wx'});
 fs.writeFileSync(preload,`import fs from 'node:fs';globalThis.fetch=async input=>{const u=new URL(typeof input==='string'?input:input.url);if(u.hostname!=='registry.npmjs.org')throw Error('Unexpected provider request in offline smoke');fs.appendFileSync(${JSON.stringify(hits)},'check\\n');return new Response(JSON.stringify({name:${JSON.stringify(pkg.name)},version:'99.0.0'}),{status:200,headers:{'Content-Type':'application/json'}});};`,{flag:'wx'});
 const automaticEnv={[config.env+'_AUTO_UPDATE']:'1',NODE_OPTIONS:(process.env.NODE_OPTIONS||'')+' --import '+JSON.stringify(pathToFileURL(preload).href)};
 invoke(survivor,['capabilities','--json'],0,automaticEnv);invoke(survivor,['capabilities','--json'],0,automaticEnv);invoke(survivor,['version'],0,automaticEnv);
 assert.equal(fs.readFileSync(hits,'utf8').trim().split('\n').length,1);
 const disabled=path.join(b,'.runtime-hidden');fs.renameSync(path.join(b,'.runtime'),disabled);try{invoke(survivor,['version'],1);}finally{fs.renameSync(disabled,path.join(b,'.runtime'));}
 let operation;
 if(config.skill==='sealseek-media'){
  const r=body(survivor,['image','generate','--prompt','offline reference validation','--dry-run','--json']);assert(r.ok!==false);operation='image generation dry-run without service submission';
 }else if(config.skill==='cloud-hug-style-transfer'){
  const input=path.join(dir,'comparison.json');fs.writeFileSync(input,JSON.stringify({run_id:'isolated',row_index:1,top:0,source:{url:'https://example.com/source.png',width:600,height:900},result:{url:'https://example.com/result.png',width:600,height:900}}),{flag:'wx'});
  assert.equal(body(survivor,['canvas','row','--input',input]).batch.media.length,2);operation='comparison canvas row calculation';
 }else{
  const require=createRequire(path.join(runtime,'package.json')),sharp=require('sharp');
  const input=path.join(dir,'原图.png'),regions=path.join(dir,'区域.json'),output=path.join(dir,'涂黑.png');
  fs.writeFileSync(input,await sharp({create:{width:60,height:40,channels:3,background:'pink'}}).png().toBuffer(),{flag:'wx'});
  fs.writeFileSync(regions,JSON.stringify({coordinate_width:60,coordinate_height:40,cover:[{points:[[5,5],[50,5],[50,35],[5,35]]}]}),{flag:'wx'});
  assert.equal(body(survivor,['blackout','--source',input,'--regions',regions,'--output',output]).width,60);assert.equal((await sharp(output).metadata()).height,40);operation='local product blackout writes and verifies actual image';
 }
 console.log(JSON.stringify({ok:true,package:pkg.name,version:pkg.version,packedInstall:true,scriptsDisabled:true,independentRuntime:true,bootstrapRemoved:true,otherHostRemoved:true,identityDriftRejected:true,realNpmCandidateAcquisition:true,partialFailure:true,packedLocalEditsProtected:true,resourceSetDriftRejected:true,repeatedRecovery:true,originalBackupPreserved:true,rollback:true,rollbackFailureRecovery:true,candidateIdentityProtected:true,acquisitionFailureRecovery:true,unknownActivatedResultRecovered:true,ordinaryEntryDetection:true,persistentThrottle:true,missingRuntimeRefused:true,businessSmoke:operation,hostDiscovery:'not-attested',platform:process.platform},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
