import {statSync,chmodSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const recovery='Run dependencies setup --json to verify this package-managed binary; reinstall with optional dependencies enabled if it is missing. Alternatively install FFmpeg/ffprobe in PATH or set SEALSEEK_MEDIA_FFPROBE_BIN to its executable.';
const bundled=()=>require('@ffprobe-installer/ffprobe').path;
export function ffprobeCommand({env=process.env,packaged=bundled}={}){
  if(env.SEALSEEK_MEDIA_FFPROBE_BIN)return {file:env.SEALSEEK_MEDIA_FFPROBE_BIN,source:'configured'};
  try{const file=packaged();if(file)return {file,source:'package'};}catch{}
  return {file:'ffprobe',source:'PATH'};
}
export function runFFprobe(args,{spawn=spawnSync,...options}={}){
  const command=ffprobeCommand(options);
  return spawn(command.file,args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true,shell:false,env:options.env||process.env});
}
export function ffprobeStatus(options={}){
  const command=ffprobeCommand(options),r=runFFprobe(['-version'],options);
  const version=r.status===0&&/^ffprobe version ([^\r\n]+)/m.exec(r.stdout||'')?.[1];
  return version?{ok:true,source:command.source,version}:{ok:false,source:command.source,error:{code:'DEPENDENCY_UNAVAILABLE',dependency:'ffprobe',message:recovery}};
}

export function setupFFprobe(){
  const command=ffprobeCommand();
  // Only the canonical npm dependency's own binary may have its executable bit restored.
  if(command.source==='package'&&process.platform!=='win32'){
    const info=statSync(command.file);
    if(info.isFile()&&!(info.mode&0o100))chmodSync(command.file,info.mode|0o100);
  }
  return ffprobeStatus();
}
