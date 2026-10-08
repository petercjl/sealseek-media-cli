#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, META, MediaError, requireValue, parse, publicError } from '../src/core.mjs';
import { connect, desktopConfig, call } from '../src/mcp.mjs';
import { prepare, reference, upload, download } from '../src/media.mjs';
import { submit, getJob, summary, waitJob, worker } from '../src/jobs.mjs';
import { SOURCE, status, install } from '../src/skills.mjs';
import { localAuthStatus,logout } from '../src/auth.mjs';
import { startLogin,loginStatus,serveLogin } from '../src/auth-web.mjs';

const HELP=`sealseek-media ${META.version}
SealSeek image and video generation. Routing is configured in the calling Agent. Node.js >=22.

  version
  doctor [--live] --json
  capabilities [--live] --json
  auth status [--live] [--login-id UUID] --json
  auth login --json                  (returns a local webpage; user scans official QR)
  auth logout [--desktop] --yes --json (private backups before credential removal)
  image|video generate --model ID --prompt TEXT [--reference FILE_OR_URL ...]
    [--ratio RATIO] [--resolution VALUE] [--size WxH] [--count N]
    [--duration SECONDS] [--first FILE_OR_URL] [--last FILE_OR_URL]
    [--prompt-file FILE] [--output DIR] [--timeout SECONDS]
    [--dry-run | --submit] [--new] --json
  image upload FILE --submit --json
  task get ID --json
  task wait ID [--timeout 30] --json     (bounded wait, 1-60 seconds)
  task download ID --output DIR --json  (uses stored URLs, never regenerates)
  artifacts list [--type image|video] [--page N] [--limit N] --json
  skill source --json
  skill status|install|update --agent codex|workbuddy|sealseek [--path DIR] --json
  update check --json
  update install --yes --json

Desktop discovery: --config FILE, --server NAME. These override the current
user's SealSeek desktop configuration. Credentials stay outside this package.
Generation defaults to dry-run. --submit executes a real generation request.
Legacy --via sealseek is accepted for compatibility and is optional.
Same requests reuse the saved local task; --new explicitly creates another.
`;
const common=['json','config','server'];
const out=value=>console.log(JSON.stringify(value,null,2));
async function withConnection(options,fn) { const c=await connect(options); try { return await fn(c); } finally { await c.close(); } }
async function main(argv) {
  const [command, action, ...rest]=argv;
  if (!command || ['--help','-h','help'].includes(command)) return console.log(HELP);
  if (['version','--version','-v'].includes(command)) return console.log(`sealseek-media ${META.version}`);
  if (command === '_worker') return worker(action);
  if(command==='_auth-worker')return serveLogin(action,{verify:async token=>{const c=await connect({authToken:token});try{await call(c,'list_artifacts',{pageNum:1,pageSize:1},30000);}finally{await c.close();}}});
  if(command==='auth'){
    const {options,args}=parse(rest,[...common,'live','login-id','desktop','yes']);requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    if(action==='login')return out({ok:true,...await startLogin()});
    if(action==='logout')return out(await logout(options));
    if(action==='status'){
      if(options['login-id'])return out({ok:true,...await loginStatus(options['login-id'])});
      const v=await localAuthStatus(options);if(options.live)return withConnection(options,async c=>{await call(c,'list_artifacts',{pageNum:1,pageSize:1},30000);out({...v,verified:true});});
      return out({...v,verified:false});
    }
  }
  if (command === 'doctor' || command === 'capabilities') {
    const {options,args}=parse(argv.slice(1),[...common,'live']); requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    const manifest=JSON.parse(await fs.readFile(path.join(SOURCE,'capabilities.json'),'utf8'));
    if (command === 'capabilities' && !options.live) return out({ok:true,version:META.version,policy:'host-configured',manifest});
    let config; try { config=await desktopConfig(options); } catch(e) { process.exitCode=1; return out({ok:false,version:META.version,node:process.version,platform:process.platform,error:publicError(e)}); }
    const result={ok:true,version:META.version,node:process.version,platform:process.platform,authentication:{present:true,source:config.source,...config.metadata},supported_platform:process.platform==='darwin', ...(command==='capabilities'?{manifest}:{})};
    if (options.live) return withConnection(options,c=>out({...result,tools:c.tools.filter(t=>['generate_image','generate_video','create_upload_urls','list_artifacts'].includes(t.name)),server_info:c.client.getServerVersion()}));
    return out(result);
  }
  if (['image','video'].includes(command) && action === 'generate') {
    const {options,args}=parse(rest,[...common,'prompt','prompt-file','model','reference','ratio','resolution','size','count','duration','first','last','output','timeout','dry-run','via','submit','new'],['reference']);
    requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    const request=await withConnection(options,c=>prepare(command,options,c.tools));
    if (!options.submit) return out({ok:true,dry_run:true,paid_action:false,kind:request.kind,tool:request.tool,arguments:request.args,local_uploads:request.refs.filter(r=>r.file).length+(request.first?.file?1:0)+(request.last?.file?1:0),output:request.output});
    return out(await submit(request,options));
  }
  if (command==='image' && action==='upload') {
    const {options,args}=parse(rest,[...common,'via','submit']); requireValue(args.length===1,'INVALID_INPUT','Provide one image file.');
    requireValue(options.submit,'SUBMIT_REQUIRED','Uploading requires --submit.');
    requireValue(!options.via || options.via==='sealseek','INVALID_INPUT','This CLI executes SealSeek media requests.');
    const ref=await reference(args[0]); return withConnection(options,async c=>out({ok:true,url:await upload(c,ref)}));
  }
  if (command==='task') {
    const {options,args}=parse(rest,['json','timeout','output']); requireValue(args.length===1,'INVALID_INPUT','Provide one task UUID.');
    if (action==='get') return out(summary(await getJob(args[0])));
    if (action==='wait') return out(await waitJob(args[0],Number(options.timeout || 30)));
    if (action==='download') {
      const job=await getJob(args[0]); requireValue(job.result?.urls?.length && options.output,'INVALID_INPUT','Stored URLs and --output are required.');
      return out({ok:true,task_id:job.id,artifacts:await download(job.result.urls,job.request.kind,path.resolve(options.output),job.id)});
    }
  }
  if (command==='artifacts' && action==='list') {
    const {options,args}=parse(rest,[...common,'type','page','limit']); requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    const input={pageNum:Number(options.page || 1),pageSize:Number(options.limit || 10)};
    requireValue(Number.isInteger(input.pageNum)&&input.pageNum>0&&Number.isInteger(input.pageSize)&&input.pageSize>0&&input.pageSize<=50,'INVALID_INPUT','Page must be positive; limit is 1-50.');
    if (options.type) input.type=options.type;
    return withConnection(options,async c=>out({ok:true,artifacts:await call(c,'list_artifacts',input,30000)}));
  }
  if (command==='skill') {
    const {options,args}=parse(rest,['json','agent','path','force']); requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    if (action==='source') return out({ok:true,source:SOURCE,name:'sealseek-media',version:META.version});
    if (action==='status') return out(await status(options.agent,options.path));
    if (['install','update'].includes(action)) return out(await install(options.agent,options));
  }
  if (command==='update') {
    const {options,args}=parse(rest,['json','yes']); requireValue(!args.length,'INVALID_INPUT','Unexpected arguments.');
    const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(META.name)}/latest`,{signal:AbortSignal.timeout(20000)});
    requireValue(response.ok,'REGISTRY_UNAVAILABLE','No published stable package is available, or registry is offline.');
    const remote=await response.json();
    if (action==='check') return out({ok:true,current:META.version,latest:remote.version,update_available:remote.version!==META.version});
    if (action==='install') {
      requireValue(options.yes,'PERMISSION_REQUIRED','Package update requires --yes.');
      requireValue(!await fs.stat(path.join(ROOT,'.git')).catch(()=>null),'DEVELOPMENT_CHECKOUT','Update a Git checkout through Git; packaged installs use update install.');
      const managed=[]; for (const agent of ['codex','workbuddy','sealseek']) if ((await status(agent)).managed) managed.push(agent);
      const npm=process.platform==='win32'?'npm.cmd':'npm';
      const result=spawnSync(npm,['install','--global',`${META.name}@${remote.version}`,'--ignore-scripts'],{encoding:'utf8'});
      requireValue(result.status===0,'UPDATE_FAILED','npm package update failed. The existing Skill installation is preserved.');
      for(const agent of managed) { const sync=spawnSync('sealseek-media',['skill','update','--agent',agent,'--json'],{encoding:'utf8'}); requireValue(sync.status===0,'SKILL_SYNC_FAILED','Package updated; managed Skill synchronization failed.'); }
      return out({ok:true,version:remote.version,skills_synchronized:managed});
    }
  }
  throw new MediaError('UNKNOWN_COMMAND','Unknown command. Use sealseek-media --help.');
}
main(process.argv.slice(2)).catch(e=>{out({ok:false,error:publicError(e)});process.exitCode=1;});
