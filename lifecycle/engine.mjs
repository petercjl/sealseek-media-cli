import {parseDocument} from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Package-owned lifecycle implementation. No host directory inference or service access.
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
export const config=pkg.skillLifecycle;
export const source=path.join(root,'skills',config.skill);
const marker='.agent-package.json',ui='agents/openai.yaml';
export const fail=(code,message,details={})=>Object.assign(new Error(message),{code,details});
const exists=p=>{try{return fs.lstatSync(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(p,v)=>{if(exists(p))throw fail('OUTPUT_EXISTS','Preserving existing file.',{path:p});fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});};
function copyTree(from,to,options={}) {
 const initial=fs.realpathSync(from),base=fs.statSync(from).isDirectory()?initial:path.dirname(initial);
 function copy(src,dest,parents=new Set()) {
  const real=fs.realpathSync(src),stat=fs.statSync(real);
  if(stat.isDirectory()) {
   if(parents.has(real))throw fail('UNSAFE_LINK','Cyclic source directory dependency.');
   fs.mkdirSync(dest,{recursive:true});const next=new Set(parents);next.add(real);
   for(const name of fs.readdirSync(real)){if(options.skipDependencies&&real===initial&&name==='node_modules')continue;copy(path.join(real,name),path.join(dest,name),next);}
  } else if(stat.isFile()) {
   if(exists(dest))throw fail('OUTPUT_EXISTS','Copy destination already exists.',{path:dest});
   fs.mkdirSync(path.dirname(dest),{recursive:true});
   // npm bin aliases become real launchers pointing only within this copied runtime.
   if(fs.lstatSync(src).isSymbolicLink()&&path.basename(path.dirname(src))==='.bin'&&real.startsWith(base+path.sep)) {
    const relative=path.relative(path.dirname(dest),path.join(to,path.relative(base,real)));
    const text='#!/usr/bin/env node\nconst {spawnSync}=require("node:child_process");const path=require("node:path");const r=spawnSync(process.execPath,[path.resolve(__dirname,'+JSON.stringify(relative)+'),...process.argv.slice(2)],{stdio:"inherit"});process.exit(r.status??1);\n';
    fs.writeFileSync(dest,text,{flag:'wx',mode:stat.mode&0o777});
   }else{fs.copyFileSync(real,dest,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE);fs.chmodSync(dest,stat.mode&0o777);}
  }else throw fail('UNSAFE_FILE','Unsupported runtime dependency file.');
 }copy(from,to);
}
export function inventory(dir,{skip=[]}={}) {
 const result={};
 function walk(base='') {for(const ent of fs.readdirSync(path.join(dir,base),{withFileTypes:true})) {
  const rel=base?base+'/'+ent.name:ent.name;
  if(skip.includes(rel))continue;
  if(ent.isSymbolicLink())throw fail('UNSAFE_LINK','Managed content contains a symbolic link.',{file:rel});
  if(ent.isDirectory())walk(rel);else if(ent.isFile())result[rel]=hash(fs.readFileSync(path.join(dir,rel)));
  else throw fail('UNSAFE_FILE','Unsupported managed file type.',{file:rel});
 }}walk();return result;
}
function validHashes(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([k,v])=>k&&!path.isAbsolute(k)&&!k.includes('\\')&&!k.split('/').some(x=>['.','..',''].includes(x))&&/^[a-f0-9]{64}$/.test(v));}
const equal=(a,b)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
const canonical=()=>inventory(source);
export function resolveTarget(options={},env=process.env) {
 const explicit=['path','root','home','target-directory','skill-path','agent'].some(k=>options[k]!==undefined);
 const agent=(explicit?options.agent:env[config.env+'_AGENT'])??'generic';
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(agent))throw fail('INVALID_TARGET','Use a lowercase Agent identifier.');
 const locations=['path','root','home','target-directory','skill-path'].filter(k=>options[k]!==undefined);
 if(locations.length>1)throw fail('CONFLICTING_TARGET','Supply exactly one explicit destination.');
 const flag=locations[0],value=flag?options[flag]:(!explicit?env[config.env+'_SKILL_PATH']:undefined);
 if(typeof value!=='string'||!value.trim())throw fail('TARGET_PATH_REQUIRED','The current Agent must resolve its own Skill directory and pass --path.',{agent,recovery:'Resolve the current Agent directory, then retry with an explicit --path.'});
 let target=path.resolve(value,...(flag==='root'?[config.skill]:flag==='home'?['skills',config.skill]:[]));
 const tail=[];let parent=path.dirname(target);while(!exists(parent)){tail.unshift(path.basename(parent));parent=path.dirname(parent);}
 target=path.join(fs.realpathSync(parent),...tail,path.basename(target));
 const relative=path.relative(root,target);
 if(target===root||(!path.isAbsolute(relative)&&!relative.startsWith('..'+path.sep)&&relative!=='..')||(root.startsWith(target+path.sep)&&!(root===path.join(target,'.runtime')&&exists(path.join(target,marker))&&read(path.join(target,marker)).package===pkg.name)))throw fail('UNSAFE_TARGET','Skill destination must be separate from the package source.');
 if(target===os.homedir()||target===path.parse(target).root)throw fail('UNSAFE_TARGET','Resolve a dedicated Skill directory.');
 let legacySource;if(options['legacy-source']){legacySource=fs.realpathSync(options['legacy-source']);if(read(path.join(legacySource,'package.json')).name!==pkg.name)throw fail('UNMANAGED_TARGET','Explicit legacy source belongs to a different package.');}
 return {legacySource,agent,target,adapter:exists(path.join(source,'adapters',agent+'.json'))?agent:'generic',selection_source:flag?'--'+flag:'environment'};
}
function localFiles(target){return inventory(target,{skip:[marker,config.legacyMarker,'.runtime']});}
function metadata(target){
 const p=path.join(target,ui);if(!exists(p))return null;const text=fs.readFileSync(p,'utf8'),doc=parseDocument(text,{uniqueKeys:true});if(doc.errors.length)throw fail('SKILL_METADATA_INVALID','Host UI metadata must be valid YAML.');const value=doc.toJSON();
 if(doc.errors.length||!value||typeof value!=='object'||Array.isArray(value))throw fail('SKILL_METADATA_INVALID','Host UI metadata must be a YAML mapping.');
 if(value.interface!==undefined&&(!value.interface||typeof value.interface!=='object'||Array.isArray(value.interface)||Object.values(value.interface).some(x=>typeof x!=='string')))throw fail('SKILL_METADATA_INVALID','Interface values must be strings.');
 if(value.policy!==undefined&&(!value.policy||typeof value.policy!=='object'||Array.isArray(value.policy)))throw fail('SKILL_METADATA_INVALID','Policy must be a mapping.');
 if(value.policy?.allow_implicit_invocation!==undefined&&typeof value.policy.allow_implicit_invocation!=='boolean')throw fail('SKILL_METADATA_INVALID','Implicit invocation policy must be boolean.');
 const products=value.policy?.products;if(products!==undefined&&(!Array.isArray(products)||products.some(x=>!['chatgpt','codex','atlas','CHATGPT','CODEX','ATLAS','api'].includes(x))))throw fail('SKILL_METADATA_INVALID','Unsupported host product policy.');
 if(products?.includes('api')){const valid=products.filter(x=>x!=='api');if(!valid.length)throw fail('SKILL_METADATA_INVALID','Legacy product policy needs explicit resolution.');doc.setIn(['policy','products'],valid);return doc.toString();}
 return text;
}
function inspectStatus(resolution,{from=resolution.legacySource||root}={}) {
 const {target,agent,adapter}=resolution,st=exists(target),identity={ok:true,package:pkg.name,version:pkg.version,target,destination:target,agent,adapter,source,hostDiscovery:'pending'};
 if(!st)return {...identity,installed:false,managed:false,current:false,up_to_date:false};
 if(st.isSymbolicLink()) {
  const actual=fs.realpathSync(target),sources=[source,path.join(from,'skills',config.skill)];
  const managed=sources.some(s=>exists(s)&&fs.realpathSync(s)===actual);
  let edited=false,editedFiles=[],recordVersion;
  if(managed){
   const ownerRoot=path.resolve(actual,'../..');if(read(path.join(ownerRoot,'package.json')).name!==pkg.name)throw fail('UNMANAGED_TARGET','Legacy link owner mismatch.');recordVersion=read(path.join(ownerRoot,'package.json')).version;
   let baseline;const release=path.join(ownerRoot,'release-integrity.json'),prefix='skills/'+config.skill+'/';
   if(exists(release)){const files=read(release).files;baseline=Object.fromEntries(Object.entries(files||{}).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k.slice(prefix.length),v]));}
   else for(const file of ['skill-integrity.json','npm/integrity.json'])if(exists(path.join(ownerRoot,file))){baseline=read(path.join(ownerRoot,file));break;}
   if(!validHashes(baseline)||!Object.keys(baseline).length)throw fail('LEGACY_INTEGRITY_REQUIRED','Verify this legacy link against its exact published archive before migration.');
   const files=inventory(actual);editedFiles=Object.keys({...baseline,...files}).filter(k=>k!==ui&&files[k]!==baseline[k]);edited=editedFiles.length>0;metadata(target);
  }
  return {...identity,installed:true,managed,current:false,up_to_date:false,mode:'link',migrationRequired:managed,edited,editedFiles,recordVersion};
 }
 if(!st.isDirectory())return {...identity,installed:true,managed:false,current:false};
 let record;try{record=read(path.join(target,marker));}catch{try{record=read(path.join(target,config.legacyMarker));}catch{}}
 if(!record&&resolution.legacySource){const baseline=inventory(path.join(resolution.legacySource,'skills',config.skill)),actual=localFiles(target);if(Object.keys(actual).every(k=>k===ui||baseline[k]===actual[k])&&Object.keys(baseline).every(k=>actual[k]!==undefined))record={package:pkg.name,version:read(path.join(resolution.legacySource,'package.json')).version,hashes:baseline};}
 const owned=record?.package===pkg.name||record?.owner===pkg.name;
 const hashes=record?.hashes||record?.files;
 if(owned&&!validHashes(hashes))throw fail('UNMANAGED_STATE','Invalid managed hash record; preserve it for recovery.');
 if(!owned)return {...identity,installed:true,managed:false,current:false};
 const actual=localFiles(target),tracked=Object.keys(hashes).filter(k=>!k.startsWith('.runtime/')&&![marker,config.legacyMarker].includes(k));
 const editedFiles=tracked.filter(k=>k!==ui&&actual[k]!==undefined&&actual[k]!==hashes[k]);const edited=editedFiles.length>0;
 const missing=tracked.filter(k=>actual[k]===undefined);
 const unknown=Object.keys(actual).filter(k=>k!==ui&&!Object.hasOwn(hashes,k));
 const expected=canonical();
 if(exists(path.join(target,'.runtime'))?.isSymbolicLink())throw fail('UNSAFE_LINK','Installed runtime must be a physical directory.');
 let runtime=null;try{runtime=read(path.join(target,'.runtime',marker));}catch{}
 let runtimeCurrent=false,runtimeEdited=false;
 if(runtime?.package===pkg.name&&validHashes(runtime.hashes)) {
  const files=inventory(path.join(target,'.runtime'),{skip:[marker]});
  const changed=Object.keys({...runtime.hashes,...files}).filter(k=>files[k]!==undefined&&files[k]!==runtime.hashes[k]);editedFiles.push(...changed.map(k=>'.runtime/'+k));runtimeEdited=changed.length>0;
  runtimeCurrent=equal(files,runtime.hashes)&&runtime.version===pkg.version&&runtime.sourceIdentity===releaseIdentity();
 }
 const metadataText=metadata(target),metadataCurrent=metadataText!==null&&metadataText===fs.readFileSync(path.join(target,ui),'utf8');
 const current=metadataCurrent&&!edited&&!unknown.length&&!missing.length&&!runtimeEdited&&runtimeCurrent&&record.version===pkg.version&&Object.entries(expected).every(([k,v])=>k===ui||actual[k]===v);
 return {...identity,installed:true,managed:true,mode:'copy',current,up_to_date:current,edited:edited||runtimeEdited,editedFiles,unknown,missing,runtimeCurrent,recordVersion:record.version};
}
export function status(resolution,options={}) {
 const s=inspectStatus(resolution,options);
 const recovery=s.current?{action:'host-discovery',mutates:false}:!s.managed&&s.installed?{action:'preserve-unmanaged-target',mutates:false}:s.edited?{action:'preserve-local-edits',mutates:false}:{action:'reconcile-selected-target',command:['skill','update','--agent',resolution.agent,'--path',resolution.target,'--json'],mutates:true};
 return {...s,schemaVersion:1,name:config.skill,installedVersion:s.recordVersion||null,selectionSource:resolution.selection_source,up_to_date:Boolean(s.current),edited:Boolean(s.edited),editedFiles:s.editedFiles||[],missing:s.missing||[],unknown:s.unknown||[],verification:{scope:'managed-skill-and-runtime',algorithm:'sha256',verified:Boolean(s.managed&&s.current)},recovery,complete:false};
}
export const maintenanceContract={schemaVersion:1,agentEligibility:'valid-name-with-generic-fallback',hostDiscoveryAuthority:'host',targetOptions:{'--path':{kind:'skill-directory'},'--target-directory':{kind:'skill-directory'},'--root':{kind:'skill-parent'},'--home':{kind:'host-root'}},source:{name:{field:'name',type:'string'},package:{field:'package',type:'string'},version:{field:'version',type:'string'},path:{field:'source',type:'string'}},status:{name:{field:'name',type:'string'},package:{field:'package',type:'string'},version:{field:'version',type:'string'},target:{field:'target',type:'string'},installed:{field:'installed',type:'boolean'},managed:{field:'managed',type:'boolean'},current:{field:'up_to_date',type:'boolean'},edited:{field:'editedFiles',type:'string[]'},verification:{field:'verification',type:'object'},recovery:{field:'recovery',type:'object'}},legacyFields:{current:'boolean alias of up_to_date',edited:'boolean retained; use editedFiles for paths'},evidenceReuse:'Reuse matching package/version/target/integrity receipts within the operation; repeat only after mutation, conflict or stale channel evidence.'};
function releaseIdentity(){return hash(fs.readFileSync(path.join(root,'release-integrity.json')));}
function guard(resolution){const s=status(resolution);if(s.installed&&!s.managed)throw fail('UNMANAGED_TARGET','Existing target is user-owned; choose a new path.',{target:s.target});if(s.edited)throw fail('LOCAL_EDITS','Managed content has local edits; preserve them before updating.',{target:s.target});if(s.unknown?.length)throw fail('UNMANAGED_FILE','Target contains untracked files; preserve them before updating.',{files:s.unknown});return s;}
function verifyCandidate(from){
 const identity=read(path.join(from,'package.json')),manifest=read(path.join(from,'release-integrity.json'));
 if(identity.name!==pkg.name||manifest.package!==identity.name||manifest.version!==identity.version||!validHashes(manifest.files))throw fail('CANDIDATE_IDENTITY_MISMATCH','Candidate package and release identity must agree.');
 for(const [name,digest]of Object.entries(manifest.files))if(!exists(path.join(from,name))||hash(fs.readFileSync(path.join(from,name)))!==digest)throw fail('CANDIDATE_CONTENT_DRIFT','Candidate content differs from its release manifest.',{file:name});
}
function dependencySource(name,owner){
 if(!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name)||['.','..'].includes(name))throw fail('INVALID_DEPENDENCY','Invalid dependency package identifier.');
 let current=owner;while(true){const candidate=path.join(current,'node_modules',...name.split('/'));if(exists(path.join(candidate,'package.json')))return fs.realpathSync(candidate);const parent=path.dirname(current);if(parent===current)return null;current=parent;}
}
function copyDependencies(owner,destination,ancestors=[]) {
 const metadata=read(path.join(owner,'package.json'));
 const requested={...(metadata.peerDependencies||{}),...(metadata.dependencies||{}),...(metadata.optionalDependencies||{})};
 for(const name of Object.keys(requested)) {
  const dep=dependencySource(name,owner),optional=Object.hasOwn(metadata.optionalDependencies||{},name)||metadata.peerDependenciesMeta?.[name]?.optional===true;
  if(!dep){if(optional)continue;throw fail('RUNTIME_DEPENDENCY_MISSING','An installed runtime dependency is missing.',{dependency:name});}
  if(ancestors.some(x=>x.name===name&&x.source===dep))continue;
  const dest=path.join(destination,'node_modules',...name.split('/'));
  if(exists(dest))throw fail('RUNTIME_DEPENDENCY_CONFLICT','Dependency destinations overlap.',{dependency:name});
  copyTree(dep,dest,{skipDependencies:true});
  copyDependencies(dep,dest,[...ancestors,{name,source:dep}]);
  const info=read(path.join(dep,'package.json')),bins=typeof info.bin==='string'?{[name.split('/').at(-1)]:info.bin}:info.bin||{};
  for(const [alias,entry]of Object.entries(bins)){
   if(!/^[a-zA-Z0-9_.-]+$/.test(alias)||typeof entry!=='string')throw fail('INVALID_PACKAGE_BIN','Invalid dependency command alias.');
   const file=path.join(destination,'node_modules','.bin',alias),entryPath=path.resolve(dest,entry);if(!entryPath.startsWith(dest+path.sep))throw fail('INVALID_PACKAGE_BIN','Dependency command escapes its package.');
   if(!exists(file)){fs.mkdirSync(path.dirname(file),{recursive:true});const rel=path.relative(path.dirname(file),entryPath);fs.writeFileSync(file,'#!/usr/bin/env node\nconst {spawnSync}=require("node:child_process"),path=require("node:path");const r=spawnSync(process.execPath,[path.resolve(__dirname,'+JSON.stringify(rel)+'),...process.argv.slice(2)],{stdio:"inherit"});process.exit(r.status??1);\n',{flag:'wx',mode:0o755});}
  }
 }
}
function copyPackage(from,to) {
 verifyCandidate(from);
 const metadata=read(path.join(from,'package.json'));
 fs.mkdirSync(to,{recursive:true});
 for(const name of ['package.json',...(metadata.files||[])]) {
  if(name.includes('*')||path.isAbsolute(name)||name.split('/').includes('..'))throw fail('INVALID_PACKAGE_FILES','Only explicit package files are supported.');
  const p=path.join(from,name);
  if(exists(p))copyTree(p,path.join(to,name),{recursive:true,dereference:true,force:false,errorOnExist:true});
 }
 copyDependencies(from,to);
 const hashes=inventory(to);write(path.join(to,marker),{package:metadata.name,version:metadata.version,sourceIdentity:hash(fs.readFileSync(path.join(from,'release-integrity.json'))),hashes});
}
export function activeWork(){
 if(config.skill!=='sealseek-media')return false;
 const dir=process.env.SEALSEEK_MEDIA_STATE_DIR||path.join(os.homedir(),'.local','state','sealseek-media');
 for(const folder of ['jobs','auth-sessions']){const base=path.join(dir,folder);if(!exists(base))continue;for(const name of fs.readdirSync(base)){
  let record;try{record=read(path.join(base,name));}catch{continue;}
  if(record.owner!==pkg.name||!['queued','running','generated','pending','verifying','starting'].includes(record.status))continue;
  if(Number.isSafeInteger(record.pid)&&record.pid>0){try{process.kill(record.pid,0);return true;}catch(e){if(e.code!=='ESRCH')return true;}}
  else if(Date.now()-Date.parse(record.created_at)<120000)return true;
 }}return false;
}
function requireIdle(resolution){if(exists(resolution.target)&&activeWork())throw fail('ACTIVE_WORK','Existing media work is active; defer maintenance and follow its saved task ID.');}
function operations(resolution){return path.join(path.dirname(resolution.target),'.'+path.basename(resolution.target)+'-operations');}
function createOperation(resolution,extra={}){const id=crypto.randomUUID(),folder=path.join(operations(resolution),id);fs.mkdirSync(folder,{recursive:true,mode:0o700});const record={schema:1,id,package:pkg.name,target:resolution.target,agent:resolution.agent,from:status(resolution).recordVersion||null,bootstrapVersion:pkg.version,stage:'preflight',packageComplete:false,skillComplete:false,hostDiscovery:'pending',createdAt:new Date().toISOString(),...extra};write(path.join(folder,'000-preflight.json'),record);return {id,folder,record,step:1};}
function phase(op,stage,extra={}){Object.assign(op.record,{stage,...extra});if(['complete','rolled-back'].includes(stage))delete op.record.error;write(path.join(op.folder,String(op.step++).padStart(3,'0')+'-'+stage+'.json'),op.record);}
export function operationStatus(resolution,id) {
 if(id&&!/^[a-f0-9-]{36}$/.test(id))throw fail('INVALID_OPERATION','Expected an operation UUID.');
 let folder=id&&path.join(operations(resolution),id);
 if(!folder){const entries=exists(operations(resolution))?fs.readdirSync(operations(resolution)):[];folder=entries.map(x=>path.join(operations(resolution),x)).filter(x=>exists(x)?.isDirectory()).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];}
 if(!folder||!exists(folder))throw fail('OPERATION_NOT_FOUND','No recorded operation for this target.');
 const records=fs.readdirSync(folder).filter(x=>/^\d+-.*\.json$/.test(x)).sort();const record=read(path.join(folder,records.at(-1)));
 if(record.package!==pkg.name||record.target!==resolution.target)throw fail('UNMANAGED_STATE','Operation ownership mismatch.');
 let installation;try{installation=status(resolution);}catch(e){installation={ok:false,code:e.code||'TARGET_STATE_INVALID',message:'Inspect the current target without discarding its recorded backup.'};}
 return {ok:true,...record,operationDirectory:folder,installation};
}
function lock(resolution){
 fs.mkdirSync(path.dirname(resolution.target),{recursive:true});const file=resolution.target+'.package-lock';
 function acquire(){
  try{const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({package:pkg.name,pid:process.pid,target:resolution.target}));return ()=>{fs.closeSync(fd);fs.unlinkSync(file);};}
  catch(e){if(e.code!=='EEXIST')throw e;}
  const st=exists(file);if(!st?.isFile()||st.isSymbolicLink())throw fail('UNMANAGED_STATE','Preserving an unsafe target lock.',{lock:file});
  let bytes,held;try{bytes=fs.readFileSync(file);held=JSON.parse(bytes);}catch{throw fail('UNMANAGED_STATE','Preserving an invalid target lock.',{lock:file});}
  if(held.package!==pkg.name||!Number.isSafeInteger(held.pid)||held.pid<=0)throw fail('UNMANAGED_STATE','Target lock ownership is invalid.',{lock:file});
  let dead=false;try{process.kill(held.pid,0);}catch(e){dead=e.code==='ESRCH';}
  if(!dead)throw fail('UPDATE_BUSY','A live process holds the target lock.',{lock:file,pid:held.pid});
  const current=exists(file);if(!current||current.ino!==st.ino||!fs.readFileSync(file).equals(bytes))throw fail('UPDATE_BUSY','Target lock changed during inspection.',{lock:file});
  fs.renameSync(file,file+'.stale-'+crypto.randomUUID());return acquire();
 }return acquire();
}
function snapshot(resolution,op){if(!exists(resolution.target)){op.record.targetFingerprint={};return null;}const dest=path.join(op.folder,'before');copyTree(resolution.target,dest,{recursive:true,dereference:true,force:false,errorOnExist:true});const a=inventory(resolution.target,{skip:[]}),b=inventory(dest);if(!equal(a,b))throw fail('BACKUP_VERIFICATION_FAILED','Pre-replacement backup hash mismatch.');op.record.targetFingerprint=a;if(exists(resolution.target)?.isSymbolicLink()){const actual=fs.realpathSync(resolution.target),owner=path.resolve(actual,'../..');if(read(path.join(owner,'package.json')).name!==pkg.name)throw fail('UNMANAGED_TARGET','Legacy package identity mismatch.');const packageBackup=path.join(op.folder,'before-package');fs.mkdirSync(packageBackup);for(const name of ['package.json',...(read(path.join(owner,'package.json')).files||[])])if(exists(path.join(owner,name)))copyTree(path.join(owner,name),path.join(packageBackup,name),{recursive:true,dereference:true,force:false,errorOnExist:true});copyDependencies(owner,packageBackup);op.record.packageBackup=packageBackup;}return dest;}
function activate(resolution,op,{from=root,rename=fs.renameSync}={}) {
 const old=guard(resolution),before=localFilesIfPresent(resolution.target),stage=path.join(op.folder,'staged');
 if(op.record.targetFingerprint&&!equal(op.record.targetFingerprint,before))throw fail('CONCURRENT_EDIT','Target differs from the original pre-replacement snapshot; preserve edits before recovery.');
 if(exists(stage))throw fail('STAGING_EXISTS','Inspect the existing staged candidate before recovery.');
 copyTree(path.join(from,'skills',config.skill),stage,{recursive:true,dereference:true,errorOnExist:true,force:false});
 const custom=old.installed?metadata(resolution.target):null;
 if(custom!==null)fs.writeFileSync(path.join(stage,ui),custom);
 copyPackage(from,path.join(stage,'.runtime'));
 const candidatePkg=read(path.join(from,'package.json'));
 write(path.join(stage,marker),{package:pkg.name,version:candidatePkg.version,source:path.join(from,'skills',config.skill),hashes:inventory(stage,{skip:['.runtime']}),runtime:'.runtime',hostDiscovery:'pending'});
 phase(op,'candidate-verified',{candidate:from,candidateVersion:candidatePkg.version,candidateIdentity:hash(fs.readFileSync(path.join(from,'release-integrity.json')))});
 // Check again immediately before replacement, including edits during candidate acquisition.
 guard(resolution);if(!equal(before,localFilesIfPresent(resolution.target)))throw fail('CONCURRENT_EDIT','Target changed after its snapshot; preserving new changes.');
 const retired=path.join(op.folder,'retired-'+crypto.randomUUID());let moved=false;
 try {if(exists(resolution.target)){rename(resolution.target,retired);moved=true;}rename(stage,resolution.target);}
 catch(e){
  if(moved&&!exists(resolution.target))fs.renameSync(retired,resolution.target);
  if(!['EPERM','EBUSY','EACCES'].includes(e.code)||!old.installed||old.mode==='link')throw e;
  // Complete backup precedes recoverable in-place sync for live directory handles.
  try{for(const name of fs.readdirSync(resolution.target))fs.rmSync(path.join(resolution.target,name),{recursive:true,force:true});copyTree(stage,resolution.target,{recursive:true,dereference:true});}
  catch(cause){throw fail('IN_PLACE_SYNC_FAILED','Restore the verified before snapshot or resume the candidate.',{backup:op.record.backup,causeCode:cause.code});}
 }
 const manifest=read(path.join(resolution.target,marker));if(!equal(localFiles(resolution.target),manifest.hashes))throw fail('SKILL_VERIFY_FAILED','Activated Skill hashes differ from the candidate.');
 const runtimeManifest=read(path.join(resolution.target,'.runtime',marker));if(!equal(inventory(path.join(resolution.target,'.runtime'),{skip:[marker]}),runtimeManifest.hashes))throw fail('RUNTIME_VERIFY_FAILED','Activated runtime hashes differ from the candidate.');
 const localEntry=path.join(resolution.target,'.runtime',config.entry);
 const probe=spawnSync(process.execPath,[localEntry,'version','--json'],{encoding:'utf8',env:{...process.env,[config.env+'_AUTO_UPDATE']:'0'},timeout:60000,windowsHide:true});
 let version;try{version=JSON.parse(probe.stdout).version;}catch{}
 if(probe.status!==0||version!==candidatePkg.version)throw fail('RUNTIME_VERIFY_FAILED','Installed local runtime failed its version probe.',{exitCode:probe.status,signal:probe.signal});
 phase(op,'complete',{packageComplete:true,skillComplete:true,version,entry:localEntry,migration:old.mode==='link'});
 return {ok:true,package:pkg.name,version,target:resolution.target,destination:resolution.target,agent:resolution.agent,adapter:resolution.adapter,installed:true,managed:true,current:true,up_to_date:true,verified:true,changed:true,state:'installed',mode:'copy',entry:localEntry,backup:op.record.backup,operationId:op.id,operationDirectory:op.folder,hostDiscovery:'pending',complete:false,requiredAction:'The current Agent must reload this Skill and verify native discovery.',migration:old.mode==='link'};
}
function localFilesIfPresent(p){return exists(p)?inventory(p):{};}
export function install(resolution,options={}) {
 const unlock=lock(resolution);let op;
 try {
  const s=guard(resolution);if(s.current)return {...s,verified:true,changed:false,state:'unchanged',complete:false,entry:path.join(s.target,'.runtime',config.entry)};
  requireIdle(resolution);
  op=createOperation(resolution,{candidate:root,candidateVersion:pkg.version,candidateIdentity:releaseIdentity()});const backup=snapshot(resolution,op);phase(op,'snapshotted',{backup});
  return activate(resolution,op,options);
 }catch(e){if(op){phase(op,'failed',{error:{code:e.code||'INSTALL_FAILED',stage:op.record.stage,message:e.message,details:e.details},recovery:'Inspect update operation, then update resume with this operation ID.'});e.details={...e.details,operationId:op.id,operationDirectory:op.folder,backup:op.record.backup};}throw e;}finally{unlock();}
}
function npmCommand(){const options=[process.env.npm_execpath,...(process.env.PATH||'').split(path.delimiter).map(p=>path.join(p,process.platform==='win32'?'npm.cmd':'npm'))];for(const p of options.filter(Boolean)){if(!exists(p))continue;const real=fs.realpathSync(p);const script=real.endsWith('npm-cli.js')?real:path.join(path.dirname(real),'node_modules/npm/bin/npm-cli.js');if(exists(script))return script;}throw fail('NPM_UNAVAILABLE','A working npm installation is required.');}
function npm(args,cwd){const env={...process.env,npm_config_dry_run:'false',npm_config_json:'false',[config.env+'_AUTO_UPDATE']:'0'};delete env.npm_config_global;delete env.npm_config_prefix;const r=spawnSync(process.execPath,[npmCommand(),'--dry-run=false','--json=false',...args],{cwd,env,encoding:'utf8',timeout:args[0]==='view'?2500:180000,windowsHide:true,maxBuffer:1024*1024*4});if(r.status!==0)throw fail('PACKAGE_ACQUISITION_FAILED','npm did not complete; inspect recorded candidate state before retrying.',{exitCode:r.status,signal:r.signal,systemCode:r.error?.code});return r.stdout;}
export function checkUpdate(){const text=npm(['view',pkg.name,'dist-tags.latest','--json','--fetch-retries=0','--fetch-timeout=1500']);let latest;try{latest=JSON.parse(text);}catch{}if(!/^\d+\.\d+\.\d+$/.test(latest))throw fail('REGISTRY_UNAVAILABLE','Expected a stable registry version.');return {ok:true,current:pkg.version,latest,update_available:newer(latest,pkg.version)};}
export function newer(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
export function compatible(a,b){return /^\d+\.\d+\.\d+$/.test(a)&&newer(a,b)&&a.split('.')[0]===b.split('.')[0]&&(b.split('.')[0]!=='0'||a.split('.')[1]===b.split('.')[1]);}
export function update(resolution,{candidate,version,yes}={}) {
 if(!yes)throw fail('PERMISSION_REQUIRED','Package updates require --yes.');
 if(version&&!/^\d+\.\d+\.\d+$/.test(version))throw fail('INVALID_VERSION','Use a stable semantic version.');
 if(candidate&&(!path.isAbsolute(candidate)||!exists(candidate)?.isFile()||!candidate.endsWith('.tgz')))throw fail('INVALID_CANDIDATE','Use an existing absolute tarball path.');
 const unlock=lock(resolution);let op;
 try {
  guard(resolution);
  // Preserve an unresolved previous transaction; retries reuse its candidate through resume.
  try{const last=operationStatus(resolution);if(last.stage!=='complete'&&last.stage!=='rolled-back')throw fail('RECOVERY_REQUIRED','An earlier update needs inspection and resume.',{operationId:last.id});}catch(e){if(e.code!=='OPERATION_NOT_FOUND')throw e;}
  const requested=version||(!candidate?checkUpdate().latest:undefined);
  if(!candidate&&requested===pkg.version)return installUnlocked(resolution);
  if(!candidate&&exists(path.join(root,'.git')))throw fail('DEVELOPMENT_CHECKOUT','Update development source through Git; use a packed candidate for isolated QA.');
  requireIdle(resolution);
  op=createOperation(resolution,{requestedVersion:requested||null,acquisitionSpec:candidate||pkg.name+'@'+requested,acquisitionHash:candidate?hash(fs.readFileSync(candidate)):null});phase(op,'snapshotted',{backup:snapshot(resolution,op)});
  const prefix=path.join(op.folder,'acquired');phase(op,'acquiring',{candidatePrefix:prefix});
  npm(['install','--prefix',prefix,'--global=false','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',candidate||pkg.name+'@'+requested],op.folder);
  const from=path.join(prefix,'node_modules',...pkg.name.split('/')),identity=read(path.join(from,'package.json'));
  if(identity.name!==pkg.name||(requested&&identity.version!==requested))throw fail('CANDIDATE_IDENTITY_MISMATCH','Acquired package identity mismatch.');
  verifyCandidate(from);phase(op,'acquired',{candidate:from,candidateVersion:identity.version,candidateIdentity:hash(fs.readFileSync(path.join(from,'release-integrity.json'))),packageComplete:true});
  return activate(resolution,op,{from});
 }catch(e){if(op){phase(op,'failed',{error:{code:e.code||'UPDATE_FAILED',stage:op.record.stage,message:e.message,details:e.details},recovery:'Inspect operation status and resume the same candidate.'});e.details={...e.details,operationId:op.id,operationDirectory:op.folder,backup:op.record.backup};}throw e;}finally{unlock();}
}
function installUnlocked(resolution){
 const s=guard(resolution);if(s.current)return {...s,verified:true,changed:false,state:'unchanged',complete:false,entry:path.join(s.target,'.runtime',config.entry)};
 requireIdle(resolution);
 const op=createOperation(resolution,{candidate:root,candidateVersion:pkg.version,candidateIdentity:releaseIdentity()});
 try{phase(op,'snapshotted',{backup:snapshot(resolution,op)});return activate(resolution,op);}
 catch(e){phase(op,'failed',{error:{code:e.code||'SYNC_FAILED',stage:op.record.stage,message:e.message,details:e.details},recovery:'Inspect operation status and resume the recorded local candidate.'});e.details={...e.details,operationId:op.id,backup:op.record.backup,operationDirectory:op.folder};throw e;}
}

function recordedInstallation(resolution,state){
 if(!state.candidateIdentity||!state.candidateVersion||!exists(resolution.target)?.isDirectory())return null;
 try{
  const runtime=path.join(resolution.target,'.runtime'),identity=read(path.join(runtime,'package.json'));
  if(identity.name!==pkg.name||identity.version!==state.candidateVersion||hash(fs.readFileSync(path.join(runtime,'release-integrity.json')))!==state.candidateIdentity)return null;
  verifyCandidate(runtime);const record=read(path.join(runtime,marker));
  if(record.package!==pkg.name||!validHashes(record.hashes)||!equal(inventory(runtime,{skip:[marker]}),record.hashes))return null;
  const installed=read(path.join(resolution.target,marker)),actual=localFiles(resolution.target),canonical=inventory(path.join(runtime,'skills',config.skill));
  if(installed.package!==pkg.name||installed.version!==identity.version||!validHashes(installed.hashes))return null;
  if(Object.keys({...actual,...canonical}).some(k=>k!==ui&&actual[k]!==canonical[k]))return null;
  if(Object.keys({...actual,...installed.hashes}).some(k=>k!==ui&&actual[k]!==installed.hashes[k]))return null;
  const text=metadata(resolution.target);if(text===null||text!==fs.readFileSync(path.join(resolution.target,ui),'utf8'))return null;
  return {ok:true,version:identity.version,current:true,managed:true,installed:true,target:resolution.target,entry:path.join(runtime,config.entry),hostDiscovery:'pending',complete:false};
 }catch{return null;}
}
export function resume(resolution,id,{yes}={}) {
 if(!yes)throw fail('PERMISSION_REQUIRED','Resume requires --yes.');const unlock=lock(resolution);let op;
 try{
  const state=operationStatus(resolution,id);guard(resolution);requireIdle(resolution);
  op={id:state.id,folder:state.operationDirectory,record:{...state},step:fs.readdirSync(state.operationDirectory).filter(x=>/^\d+-/.test(x)).length};
  const verified=recordedInstallation(resolution,state);
  if(verified){if(state.stage!=='complete')phase(op,'complete',{packageComplete:true,skillComplete:true,version:verified.version,recoveredUnknownOutcome:true});return {...op.record,...verified,changed:false,operationId:op.id};}
  if(state.stage==='complete')throw fail('TARGET_CHANGED','The completed installation changed; inspect it before starting new maintenance.');
  let from=state.candidate||(state.candidatePrefix&&path.join(state.candidatePrefix,'node_modules',...pkg.name.split('/')));
  if(!from||!exists(path.join(from,'package.json'))){
   if(state.packageComplete||!state.acquisitionSpec||!state.candidatePrefix)throw fail('CANDIDATE_UNAVAILABLE','The recorded candidate is unavailable; preserve its transaction and backup.');
   if(state.acquisitionHash&&(!exists(state.acquisitionSpec)||hash(fs.readFileSync(state.acquisitionSpec))!==state.acquisitionHash))throw fail('CANDIDATE_IDENTITY_MISMATCH','The original archive changed before acquisition recovery.');
   if(state.targetFingerprint&&!equal(state.targetFingerprint,localFilesIfPresent(resolution.target)))throw fail('CONCURRENT_EDIT','The target changed after the original snapshot.');
   phase(op,'reacquiring',{requiredAction:'Retry only the recorded specification after confirming no acquired package is present.'});
   npm(['install','--prefix',state.candidatePrefix,'--global=false','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',state.acquisitionSpec],op.folder);
   from=path.join(state.candidatePrefix,'node_modules',...pkg.name.split('/'));
  }
  const identity=read(path.join(from,'package.json'));
  if(identity.name!==pkg.name||((state.candidateVersion||state.requestedVersion)&&(state.candidateVersion||state.requestedVersion)!==identity.version))throw fail('CANDIDATE_IDENTITY_MISMATCH','Recorded candidate identity changed.');
  verifyCandidate(from);const digest=hash(fs.readFileSync(path.join(from,'release-integrity.json')));
  if(state.candidateIdentity&&digest!==state.candidateIdentity)throw fail('CANDIDATE_IDENTITY_MISMATCH','Recorded candidate content changed; preserve the original transaction and backup.');
  phase(op,'acquired',{candidate:from,candidateVersion:identity.version,candidateIdentity:digest,packageComplete:true});
  const complete=recordedInstallation(resolution,op.record);
  if(complete){phase(op,'complete',{packageComplete:true,skillComplete:true,version:complete.version,recoveredUnknownOutcome:true});return {...op.record,...complete,changed:false,operationId:op.id};}
  const staged=path.join(op.folder,'staged');if(exists(staged))fs.renameSync(staged,path.join(op.folder,'previous-staging-'+crypto.randomUUID()));
  return activate(resolution,op,{from});
 }catch(e){if(op){phase(op,'failed',{error:{code:e.code||'RESUME_FAILED',message:e.message,details:e.details}});e.details={...e.details,operationId:op.id,backup:op.record.backup};}throw e;}
 finally{unlock();}
}

export function rollback(resolution,id,{yes}={}) {
 if(!yes)throw fail('PERMISSION_REQUIRED','Rollback requires --yes.');const unlock=lock(resolution);let op,retired;
 try {
  const state=operationStatus(resolution,id);guard(resolution);requireIdle(resolution);
  if(!state.backup||!exists(path.join(state.backup,'SKILL.md')))throw fail('BACKUP_UNAVAILABLE','No verified pre-replacement snapshot exists.');
  op={id:state.id,folder:state.operationDirectory,record:{...state},step:fs.readdirSync(state.operationDirectory).filter(x=>/^\d+-/.test(x)).length};
  const restored=path.join(op.folder,'rollback-staged-'+crypto.randomUUID());copyTree(state.backup,restored);
  if(!equal(inventory(restored),inventory(state.backup)))throw fail('BACKUP_VERIFICATION_FAILED','Rollback snapshot hashes differ.');
  phase(op,'rollback-ready',{rollbackSnapshot:state.backup});
  if(exists(resolution.target)){retired=path.join(op.folder,'before-rollback-'+crypto.randomUUID());fs.renameSync(resolution.target,retired);}
  fs.renameSync(restored,resolution.target);phase(op,'rolled-back',{packageComplete:false,skillComplete:false,rollbackSnapshot:state.backup,requiredAction:'Verify the restored version and host discovery before further maintenance.'});
  return {ok:true,...op.record,operationId:op.id};
 }catch(e){
  if(op){const recoveryEntry=retired&&exists(path.join(retired,'.runtime',config.entry))?path.join(retired,'.runtime',config.entry):path.join(root,config.entry);phase(op,'rollback-failed',{error:{code:e.code||'ROLLBACK_FAILED',message:e.message},recoveryEntry});e.details={...e.details,operationId:op.id,backup:op.record.backup,recoveryEntry};}throw e;
 }finally{unlock();}
}
function policyPath(target){const scope=target||root;return path.join(process.env[config.env+'_STATE_DIR']||path.join(os.homedir(),'.local','state',config.skill),'lifecycle',hash(Buffer.from(scope)));}
export function policy(options={},resolution){const dir=policyPath(resolution?.target),file=path.join(dir,'policy.json');let value={mode:'notify',authorized:false};if(exists(file)){value=read(file);if(value.package!==pkg.name||!['off','notify','auto'].includes(value.mode))throw fail('UNMANAGED_STATE','Preserving invalid policy file.');}
 if(options.mode){if(!options.yes)throw fail('PERMISSION_REQUIRED','Policy changes require --yes.');if(!['off','notify','auto'].includes(options.mode))throw fail('INVALID_POLICY','Choose off, notify or auto.');if(options.mode==='auto'&&!resolution)throw fail('TARGET_PATH_REQUIRED','Automatic installation requires a resolved target.');if(exists(file))fs.renameSync(file,file+'.backup-'+crypto.randomUUID());write(file,{package:pkg.name,mode:options.mode,authorized:options.mode==='auto',target:resolution?.target||null});value=read(file);}
 return {ok:true,...value,intervalHours:24,timeoutMs:2000,channel:'latest',scope:resolution?.target||root,policyFile:file};}
export async function automatic(resolution,{probe,now=Date.now()}={}) {
 if(!probe&&exists(path.join(root,'.git')))return {ok:true,state:'owner-managed'};
 if(process.env[config.env+'_AUTO_UPDATE']==='0'||process.env[config.env+'_UPDATE_CHECK']==='0')return {ok:true,state:'disabled'};
 let p;try{p=policy({},resolution);}catch(e){return {ok:false,state:'deferred',code:e.code||'INVALID_POLICY',message:'Preserving invalid update policy; inspect it before maintenance.'};}if(p.mode==='off')return {ok:true,state:'disabled'};
 const dir=policyPath(resolution?.target),file=path.join(dir,'cache.json'),locked=path.join(dir,'check.lock');let fd;
 try {
  fs.mkdirSync(dir,{recursive:true});try{fd=fs.openSync(locked,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({package:pkg.name,pid:process.pid}));}catch(e){if(e.code!=='EEXIST')throw e;const held=read(locked);if(held.package!==pkg.name||!Number.isSafeInteger(held.pid)||held.pid<=0)throw fail('UNMANAGED_STATE','Preserving invalid automatic-check lock.');let dead=false;try{process.kill(held.pid,0);}catch(cause){dead=cause.code==='ESRCH';}if(!dead)return {ok:true,state:'busy'};fs.renameSync(locked,locked+'.stale-'+crypto.randomUUID());fd=fs.openSync(locked,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({package:pkg.name,pid:process.pid}));}
  let cache;try{cache=read(file);if(cache.package!==pkg.name||!Number.isFinite(cache.time)||cache.time>now||(cache.latest!==null&&!/^\d+\.\d+\.\d+$/.test(cache.latest)))throw fail('UNMANAGED_STATE','Preserving invalid cache.');}catch(e){if(exists(file))throw e;}
  if(cache&&cache.current===pkg.version&&now-cache.time<(cache.latest?86400000:300000))return {ok:true,state:'cached',...cache};
  let latest=null;try{latest=probe?await probe():await fetch('https://registry.npmjs.org/'+encodeURIComponent(pkg.name)+'/latest',{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)throw Error('registry');return r.json();}).then(v=>{if(v.name!==pkg.name||!/^\d+\.\d+\.\d+$/.test(v.version))throw Error('metadata');return v.version;});}catch{}
  if(exists(file))fs.renameSync(file,file+'.previous-'+crypto.randomUUID());cache={package:pkg.name,time:now,current:pkg.version,latest};write(file,cache);
  if(!latest)return {ok:true,state:'offline',...cache};
  if(!newer(latest,pkg.version))return {ok:true,state:'up-to-date',...cache};
  if(activeWork())return {ok:true,state:'active-work',...cache};
  if(p.mode!=='auto')return {ok:true,state:'update-available',...cache};
  if(!p.authorized||!resolution||!compatible(latest,pkg.version))return {ok:true,state:'manual-update-required',...cache};
  if(exists(path.join(root,'.git')))return {ok:true,state:'owner-managed',...cache};
  return {ok:true,state:'updated',receipt:update(resolution,{version:latest,yes:true}),reloadSkill:true};
 }catch(e){return {ok:false,state:'deferred',code:e.code||'AUTO_CHECK_FAILED',message:e.message,details:e.details};}
 finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(locked);}}
}
export const installationLifecycle={agentNeutral:true,skillRequired:true,updateRequiresSkillSync:true,required_components:['cli','skill','runtime'],installGuide:'INSTALL.md',updateGuide:'UPDATE.md',explicitTargetRequired:true,targetRequired:true,hostDiscoveryVerification:true,hostRegistrationRequired:true,installationMode:'copy',sharedLinksAllowed:false,isolatedRuntimeRequired:true,physicalCopies:true,isolatedRuntime:true,sharedLinks:false,postBumpIdentityValidation:true,install:'Resolve the current Agent directory; skill install --agent AGENT --path EXACT_SKILL_DIR --json',update:'Resolve selected target before replacement; update install --yes --agent AGENT --path EXACT_SKILL_DIR --json',verification:'Verify local runtime version, managed hashes, then reload the host and confirm Skill discovery.',target_scope:'selected current Agent only'};
export function commandContracts(){
 const result={},target={
  '--agent':{type:'string',description:'Valid current Agent name; generic fallback for unnamed hosts.'},
  '--path':{type:'string',description:'Exact Skill destination resolved by the current Agent.'},
  '--root':{type:'string',description:'Legacy explicit parent directory; appends the canonical Skill name.'},
  '--home':{type:'string',description:'Legacy explicitly resolved host root; appends skills and Skill name.'},
  '--target-directory':{type:'string',description:'Explicit exact Skill destination alias.'}
 },common={'--json':{type:'boolean'},'--help':{type:'boolean'}},yes={'--yes':{type:'boolean',required:true}};
 for(const action of ['source','status','install','update'])result['skill '+action]={options:{...common,...(action==='source'?{}:target),...(['install','update'].includes(action)?{'--mode':{type:'string',enum:['copy','link'],description:'Legacy link requests migrate to a physical copy.'},'--legacy-source':{type:'string',description:'Explicit owning package root for verified legacy migration.'},'--force':{type:'boolean',description:'Accepted legacy flag; local edit protection remains enforced.'},'--backup-edits':{type:'boolean',description:'Accepted legacy flag; local edits require separate reconciliation.'}}:{})},sideEffects:['install','update'].includes(action)?'local-write':'none'};
 result['update check']={options:common,sideEffects:'none'};
 result['update install']={options:{...common,...target,...yes,'--candidate':{type:'string',description:'Absolute packed candidate archive for authorized installation.'},'--version':{type:'string',description:'Exact stable registry version.'}},sideEffects:'package-and-skill-update'};
 result['update operation']={options:{...common,...target,'--operation':{type:'string'}},sideEffects:'none'};
 for(const action of ['resume','rollback'])result['update '+action]={options:{...common,...target,...yes,'--operation':{type:'string'}},sideEffects:'package-and-skill-update'};
 result['update policy']={options:{...common,...target,'--yes':{type:'boolean'},'--mode':{type:'string',enum:['off','notify','auto']}},sideEffects:'local-write',writeCondition:'Only an authorized explicit --mode change writes policy.'};
 result['update status']={options:{...common,...target},sideEffects:'none'};
 return result;
}
export function parse(args){const words=[],options={},booleans=new Set(['json','yes','help','force','backup-edits']);for(let i=0;i<args.length;i++){const token=args[i];if(!token.startsWith('--')){words.push(token);continue;}const key=token.slice(2);if(key in options)throw fail('INVALID_ARGUMENT','Duplicate option '+token);if(booleans.has(key))options[key]=true;else{if(!args[i+1]||args[i+1].startsWith('--'))throw fail('INVALID_ARGUMENT','Missing value for '+token);options[key]=args[++i];}}return {words,options};}
export async function dispatch(args) {
 const managed=['skill','update'].includes(args[0]);if(!managed)return false;
 try {
  const {words,options:o}=parse(args),[command,action,mode]=words;
  const common=['json','help'];
  const targetFlags=['agent','path','root','home','target-directory'];
  const flags=command==='skill'?(action==='source'?[]:[...targetFlags,...(['install','update'].includes(action)?['mode','force','backup-edits','legacy-source']:[])])
   :action==='check'?[]:action==='install'?[...targetFlags,'yes','candidate','version']:action==='operation'?[...targetFlags,'operation']:['resume','rollback'].includes(action)?[...targetFlags,'operation','yes']:action==='status'?targetFlags:action==='policy'?[...targetFlags,'yes','mode']:action==='auto'?[...targetFlags,'yes']:[];
  const allowed=new Set([...common,...flags]);
  for(const k of Object.keys(o))if(!allowed.has(k))throw fail('INVALID_ARGUMENT','Unknown option --'+k);
  const known=command==='skill'?['source','status','install','update']:['check','install','operation','resume','rollback','policy','status','auto'];
  if(!known.includes(action)||words.length>(action==='auto'?3:2))throw fail('INVALID_COMMAND','Unknown lifecycle command.');
  const commands=['skill source','skill status|install|update --agent AGENT --path EXACT_SKILL_DIR --json','update check','update install --yes --path EXACT_SKILL_DIR [--candidate TARBALL]','update operation|resume --path EXACT_SKILL_DIR [--operation UUID]','update policy --mode off|notify|auto --yes [--path EXACT_SKILL_DIR]'];
  if(o.help){console.log(JSON.stringify({ok:true,command:words.join(' '),...commandContracts()[words.slice(0,2).join(' ')],commands,installationLifecycle},null,2));return true;}
  let result;
  if(command==='skill'&&action==='source'){
   if(Object.keys(o).some(k=>k!=='json'))throw fail('INVALID_ARGUMENT','skill source accepts only --json.');
   result={ok:true,package:pkg.name,name:config.skill,source,version:pkg.version,installation:{fallback_agent:'generic',custom_path_required:true},installationLifecycle,maintenanceContract,commandContracts:commandContracts()};
  }else if(command==='update'&&action==='check')result=checkUpdate();
  else if(command==='update'&&['policy','status','auto'].includes(action)){
   const hasTarget=['path','root','home','target-directory'].some(k=>o[k]!==undefined)||process.env[config.env+'_SKILL_PATH'];
   const own=path.basename(root)==='.runtime'&&exists(path.join(path.dirname(root),marker))&&read(path.join(path.dirname(root),marker)).package===pkg.name;
   const target=hasTarget?resolveTarget(o):own?resolveTarget({path:path.dirname(root)}):undefined;
   if(action==='auto'&&mode&&!['on','off','status'].includes(mode))throw fail('INVALID_COMMAND','Use auto on, off or status.');
   if(action==='auto'&&['on','off'].includes(mode))result=policy({mode:mode==='on'?'auto':'off',yes:o.yes},target);
   else result=policy(o,target);
  }else{
   const resolution=resolveTarget(o);
   if(command==='skill'&&o.mode&&!['copy','link'].includes(o.mode))throw fail('INVALID_ARGUMENT','Legacy mode must be copy or link; both install physical copies.');
   if(command==='skill')result=action==='status'?status(resolution):install(resolution);
   else if(action==='operation')result=operationStatus(resolution,o.operation);
   else if(action==='resume')result=resume(resolution,o.operation,{yes:o.yes});
   else if(action==='rollback')result=rollback(resolution,o.operation,{yes:o.yes});
   else result=update(resolution,{candidate:o.candidate,version:o.version,yes:o.yes});
  }
  console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;
 }catch(e){console.log(JSON.stringify({ok:false,code:e.code||'LIFECYCLE_FAILED',message:e.message,error:{code:e.code||'LIFECYCLE_FAILED',message:e.message,details:e.details||{}},details:e.details||{},complete:false},null,2));process.exitCode=1;}
 return true;
}
