#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
let lifecycle;try{lifecycle=await import('../lifecycle/engine.mjs');}catch{console.log(JSON.stringify({ok:false,code:'LIFECYCLE_DEPENDENCY_MISSING',message:'Install the owning npm package with its required dependencies before continuing.'}));process.exit(1);}
const {dispatch,automatic,resolveTarget,status,root,pkg,config,installationLifecycle}=lifecycle;
const args=process.argv.slice(2);
if(!await dispatch(args)) {
 if(args[0]==='version'||args[0]==='--version'){if(args.slice(1).some(x=>x!=='--json')||args.filter(x=>x==='--json').length>1){console.log(JSON.stringify({ok:false,code:'INVALID_ARGUMENT',message:'version accepts only one --json flag.'}));process.exitCode=1;}else console.log(JSON.stringify({ok:true,name:pkg.name,version:pkg.version,entry:process.argv[1]}));}
 else {
  let target;
  try {
   const declaration=JSON.parse(fs.readFileSync(path.join(root,'capabilities.json'),'utf8'));
   const doctorRoot=args[0]==='doctor'&&declaration.commandContracts?.doctor?.options?.['--root'];
   const binding={},clean=[];
   for(let i=0;i<args.length;i++){
    const key=args[i];if(!['--agent','--skill-path',...(doctorRoot?['--root']:[])].includes(key)){clean.push(key);continue;}
    const field=key==='--agent'?'agent':key==='--root'?'root':'skill-path';if(field in binding||!args[i+1]||args[i+1].startsWith('--'))throw Object.assign(Error('Duplicate or missing target binding'),{code:'INVALID_ARGUMENT'});binding[field]=args[++i];
   }
   if(Object.keys(binding).length)target=resolveTarget(binding);
   args.splice(0,args.length,...clean);process.argv.splice(2,process.argv.length-2,...clean);

   const marker=path.join(path.dirname(root),'.agent-package.json');
   if(!target&&path.basename(root)==='.runtime'&&fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker)).package===pkg.name)target=resolveTarget({path:path.dirname(root)});
   else if(!target&&process.env[config.env+'_SKILL_PATH'])target=resolveTarget();
  }catch(e){console.error(JSON.stringify({ok:false,code:e.code,message:e.message}));process.exit(1);}
  const ordinary=!args.includes('--help')&&!args.includes('-h')&&!['task','help','--help','-h','_worker','_auth-worker'].includes(args[0])&&args.length;
  if(ordinary&&!args.includes('--no-auto-update')){
   const receipt=await automatic(target);
   if(!['disabled','cached','up-to-date','owner-managed'].includes(receipt.state))console.error(JSON.stringify({automaticUpdate:receipt}));
   if(receipt.state==='updated'){
    console.error(JSON.stringify({reloadSkill:true,entry:receipt.receipt.entry}));
    const r=spawnSync(process.execPath,[receipt.receipt.entry,...args],{stdio:'inherit',env:{...process.env,[config.env+'_AUTO_UPDATE']:'0'},windowsHide:true});process.exit(r.status??1);
   }
   if(!receipt.ok){console.error(JSON.stringify(receipt));process.exit(1);}
  }
  if(args[0]==='doctor'&&target){
   const installation=status(target),originalLog=console.log.bind(console);
   console.log=(text,...rest)=>{let value;try{value=JSON.parse(text);}catch{return originalLog(text,...rest);}if(value&&typeof value==='object'){value.installation=installation;value.resolution=target;if(!installation.current){value.ok=false;value.code||='SKILL_RECONCILIATION_REQUIRED';process.exitCode=1;}}return originalLog(JSON.stringify(value,null,2));};
  }
  // Lifecycle and automatic maintenance are owned by the package dispatcher.
  process.env[config.env+'_AUTO_UPDATE']='0';process.env[config.env+'_UPDATE_CHECK']='0';
  await import('./business.mjs');
 }
}
