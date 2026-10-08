import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT,META,stateRoot,exists,readJson,createJson,replaceJob,requireValue,publicError,hash } from './core.mjs';
import { status } from './skills.mjs';

const DAY=86400000;
export function newer(candidate,current) {
  if(!/^\d+\.\d+\.\d+$/.test(candidate)||!/^\d+\.\d+\.\d+$/.test(current))return false;
  const a=candidate.split('.').map(Number),b=current.split('.').map(Number);
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
export async function settings(dir=stateRoot()) {
  const p=path.join(dir,'updates.json');
  const value=await exists(p)?await readJson(p):{owner:META.name,id:'updates',enabled:true};
  requireValue(value.owner===META.name&&value.id==='updates','UNMANAGED_STATE','Update settings ownership mismatch.');return value;
}
async function store(value,dir) {
  const p=path.join(dir,'updates.json');
  if(await exists(p))await replaceJob(p,value);else await createJson(p,value);
}
export async function setAutomatic(enabled) {
  const dir=stateRoot(),value=await settings(dir),p=path.join(dir,'updates.json');
  if(await exists(p))await createJson(path.join(dir,'update-backups',crypto.randomUUID()+'.json'),value);
  value.enabled=enabled;await store(value,dir);return {ok:true,...await updateStatus()};
}
export async function updateStatus() {
  const {owner,id,...value}=await settings();return {...value,channel:'latest',check_interval_hours:24,trigger:'CLI invocation',development_checkout:!!await exists(path.join(ROOT,'.git'))};
}
export async function latestVersion() {
  const r=await fetch(`https://registry.npmjs.org/${encodeURIComponent(META.name)}/latest`,{signal:AbortSignal.timeout(3000)});
  requireValue(r.ok,'REGISTRY_UNAVAILABLE','Stable npm registry metadata is unavailable.');
  const v=await r.json();requireValue(v.name===META.name&&/^\d+\.\d+\.\d+$/.test(v.version),'INVALID_REGISTRY_METADATA','Expected this package and a stable semantic version.');return v.version;
}
export async function npmCli() {
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),... (process.env.PATH||'').split(path.delimiter).map(p=>path.join(p,process.platform==='win32'?'npm.cmd':'npm'))].filter(Boolean);
  for(const candidate of candidates){
    if(!await exists(candidate))continue;
    const real=await fs.realpath(candidate);
    const script=real.endsWith('npm-cli.js')?real:path.join(path.dirname(real),'node_modules','npm','bin','npm-cli.js');
    if(await exists(script))return script;
  }
  requireValue(false,'NPM_UNAVAILABLE','A working npm installation is required for package updates.');
}
function run(script,args) {
  const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:120000,windowsHide:true});
  requireValue(r.status===0,'UPDATE_FAILED','npm update operation failed. Existing backups remain available.');return r.stdout.trim();
}
export async function globalInstallation(root=ROOT) {
  const script=await npmCli(),global=run(script,['root','--global']);
  const expected=path.join(global,...META.name.split('/'));
  return (await fs.realpath(expected).catch(()=>null))===await fs.realpath(root);
}
export async function managedTargets() {
  const targets=[];
  for(const agent of ['codex','workbuddy','sealseek']) {
    const info=await status(agent);
    requireValue(!info.managed||!info.edited,'LOCAL_EDITS','A managed Skill has local edits; review it before updating.',{agent});
    if(info.managed)targets.push(agent);
  }return targets;
}
export async function activeWork(dir=stateRoot()) {
  for(const folder of ['jobs','auth-sessions']) {
    for(const file of await fs.readdir(path.join(dir,folder)).catch(()=>[])) {
      if(!file.endsWith('.json'))continue;
      const j=await readJson(path.join(dir,folder,file)).catch(()=>null);
      if(j?.owner!==META.name||!['queued','running','generated','pending','verifying','starting'].includes(j.status))continue;
      if(j.pid){try{process.kill(j.pid,0);return true;}catch(e){if(e.code!=='ESRCH')return true;}}
      else if(Date.now()-Date.parse(j.created_at)<120000)return true;
    }
  }return false;
}
export async function installVersion(version,targets,{root=ROOT,dir=stateRoot(),npmScript=npmCli,execute=run,synchronize}={}) {
  requireValue(/^\d+\.\d+\.\d+$/.test(version),'INVALID_INPUT','Expected a stable semantic version.');
  const backup=path.join(dir,'package-backups',crypto.randomUUID());
  requireValue(!await exists(backup),'TARGET_EXISTS','Package backup already exists.');
  await fs.mkdir(path.dirname(backup),{recursive:true,mode:0o700});
  await fs.cp(root,backup,{recursive:true,errorOnExist:true,force:false,dereference:true});
  for(const file of ['package.json','bin/sealseek-media.mjs'])requireValue(hash(await fs.readFile(path.join(root,file)))===hash(await fs.readFile(path.join(backup,file))),'BACKUP_VERIFICATION_FAILED','Package backup verification failed.');
  try {
    await execute(await npmScript(),['install','--global',`${META.name}@${version}`,'--ignore-scripts','--no-audit','--no-fund']);
    const installed=await readJson(path.join(root,'package.json'));
    requireValue(installed.name===META.name&&installed.version===version,'UPDATE_VERIFICATION_FAILED','Installed package version mismatch.');
    for(const agent of targets){
      const r=synchronize?await synchronize(agent):spawnSync(process.execPath,[path.join(root,'bin','sealseek-media.mjs'),'skill','update','--agent',agent,'--json'],{encoding:'utf8',timeout:120000,env:{...process.env,SEALSEEK_MEDIA_AUTO_UPDATE:'0'},windowsHide:true});
      requireValue(r.status===0,'SKILL_SYNC_FAILED','Package installed, but managed Skill synchronization failed.',{agent,backup});
    }
    return {version,backup,skills_synchronized:targets};
  }catch(e){e.details={...e.details,backup};throw e;}
}
export async function performUpdate({automatic=true,dir=stateRoot(),root=ROOT,current=META.version,env=process.env,now=Date.now(),latest=latestVersion,isGlobal=globalInstallation,targets=managedTargets,busy=activeWork,install}={}) {
  install ||= (version,selected)=>installVersion(version,selected,{root,dir});
  if(await exists(path.join(root,'.git'))){requireValue(automatic,'DEVELOPMENT_CHECKOUT','Update a Git checkout through Git.');return {ok:true,skipped:'development_checkout'};}
  const config=await settings(dir);
  if(automatic&&(env.SEALSEEK_MEDIA_AUTO_UPDATE==='0'||!config.enabled))return {ok:true,skipped:'disabled'};
  if(automatic&&now-(config.last_check||0)<DAY)return {ok:true,skipped:'not_due'};
  const lock=path.join(dir,'update-lock.json'),id=crypto.randomUUID();
  try{await createJson(lock,{owner:META.name,id,pid:process.pid});}
  catch(e){if(e.code!=='EEXIST')throw e;const held=await readJson(lock);requireValue(held.owner===META.name,'UNMANAGED_STATE','Update lock ownership mismatch.');let alive=true;try{process.kill(held.pid,0);}catch(err){alive=err.code!=='ESRCH';}if(alive)return {ok:true,skipped:'update_in_progress'};await fs.unlink(lock);return performUpdate({automatic,dir,root,current,env,now,latest,isGlobal,targets,busy,install});}
  try {
    requireValue(await isGlobal(root),'UNSUPPORTED_INSTALLATION','Automatic updates support global npm installations; use your package manager for other installations.');
    if(await busy(dir))return {ok:true,skipped:'active_work'};
    const selected=await targets();
    config.last_check=now;await store(config,dir);
    const version=await latest();config.latest=version;delete config.error;
    if(!newer(version,current)){await store(config,dir);return {ok:true,current,latest:version,updated:false};}
    const result=await install(version,selected);config.last_update=Date.now();config.installed=version;delete config.error;await store(config,dir);
    return {ok:true,updated:true,...result};
  }catch(e){
    config.error=publicError(e);await store(config,dir);if(!automatic)throw e;return {ok:false,error:config.error};
  }finally{const held=await readJson(lock).catch(()=>null);if(held?.id===id)await fs.unlink(lock);}
}
