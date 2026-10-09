import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { META, stateRoot, readJson, createJson, exists, requireValue, hash } from './core.mjs';

export const PROVIDER = 'https://gateway.sealseek.cn';
export const MEDIA_ENDPOINT = PROVIDER + '/api/sealseek-infinitecanvas';
export const LEGACY_MEDIA_ENDPOINT = MEDIA_ENDPOINT + '/mcp';
export const authFile = () => path.resolve(process.env.SEALSEEK_MEDIA_AUTH_FILE || path.join(os.homedir(),'.config','sealseek-media','auth.json'));
export const desktopFile = options => path.resolve(options.config || process.env.SEALSEEK_MEDIA_DESKTOP_CONFIG || path.join(os.homedir(),'.sealseek','sealseek.json'));
export const isCredentialHeader = key => /^(authorization|token|cookie|x-api-key|api-key|x-auth-token)$/i.test(key);
export function tokenMetadata(token) {
 let payload;try{payload=JSON.parse(Buffer.from(token.replace(/^Bearer\s+/i,'').split('.')[1],'base64url'));}catch{}
 const seconds=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<253402300800 ? value : null;
 const exp=seconds(payload?.exp),iat=seconds(payload?.iat);
 return {expires_at:exp?new Date(exp*1000).toISOString():null,issued_at:iat?new Date(iat*1000).toISOString():null,expired:exp?Date.now()>=exp*1000:null,metadata_verified:false};
}
export async function profile() {
 const p=authFile();if(!await exists(p))return null;
 const value=await readJson(p);
 requireValue(value.owner===META.name && (typeof value.token==='string'||value.logged_out===true) && [MEDIA_ENDPOINT,LEGACY_MEDIA_ENDPOINT].includes(value.endpoint),'INVALID_CONFIG','Credential profile is not a managed SealSeek media profile.');
 return value;
}
export async function backupFile(p) {
 const before=await fs.lstat(p);requireValue(before.isFile()&&!before.isSymbolicLink(),'UNMANAGED_STATE','Expected a regular credential/configuration file.');
 const bytes=await fs.readFile(p);
 const directory=path.join(stateRoot(),'credential-backups',crypto.randomUUID());
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const backup=path.join(directory,path.basename(p));
 await fs.writeFile(backup,bytes,{flag:'wx',mode:0o600});
 requireValue(hash(await fs.readFile(backup))===hash(bytes),'BACKUP_VERIFICATION_FAILED','Credential backup verification failed.');
 return {backup,bytes,digest:hash(bytes),mode:before.mode&0o777};
}
export async function saveToken(token,{deviceType,method,channel}={}) {
 requireValue(typeof token==='string'&&token.length>20&&!/[\r\n]/.test(token),'AUTH_REJECTED','The login provider returned an invalid credential.');
 const metadata=tokenMetadata(token);requireValue(metadata.expired!==true,'AUTH_EXPIRED','The login provider returned an expired credential.');
 const p=authFile();let backup;
 if(await exists(p)){await profile();backup=await backupFile(p);}
 const value={owner:META.name,version:1,endpoint:MEDIA_ENDPOINT,token,...(channel?{login_channel:channel}:{}),...(deviceType?{device_type:deviceType}:{}),...(method?{login_method:method}:{}),saved_at:new Date().toISOString()};
 if(backup){const tmp=p+'.'+crypto.randomUUID()+'.tmp';await createJson(tmp,value);requireValue(hash(await fs.readFile(p))===backup.digest,'CONFIG_CHANGED','Credential profile changed during login.');await fs.rename(tmp,p);await fs.chmod(p,0o600);}
 else await createJson(p,value);
 return {credential_file:p,...metadata,...(backup?{backup:backup.backup}:{})};
}
export async function localAuthStatus(options={}) {
 if(!options.config&&!process.env.SEALSEEK_MEDIA_DESKTOP_CONFIG){const value=await profile();if(value)return value.logged_out?{ok:true,present:false,source:'plugin-profile',logged_out:true,expires_at:null,expired:null}:{ok:true,present:true,source:'plugin-profile',credential_file:authFile(),...tokenMetadata(value.token),device_type:value.device_type||'unknown',login_method:value.login_method||'unknown',login_channel:value.login_channel||'unknown'};}
 const p=desktopFile(options),cfg=await readJson(p).catch(()=>null),headers=cfg?.mcp?.servers?.[options.server||process.env.SEALSEEK_MEDIA_SERVER||'sealseek-canvas']?.headers||{};
 const entry=Object.entries(headers).find(([k,v])=>isCredentialHeader(k)&&typeof v==='string'&&v.trim());
 return {ok:true,present:!!entry,source:entry?'desktop-config':null,credential_file:entry?p:null,...(entry?tokenMetadata(entry[1]):{expires_at:null,expired:null})};
}
export async function logout(options={}) {
 requireValue(options.yes,'PERMISSION_REQUIRED','Removing credentials requires --yes. Credentials are backed up first.');
 const backups=[];
 if(await exists(authFile())){await profile();const b=await backupFile(authFile());requireValue(hash(await fs.readFile(authFile()))===b.digest,'CONFIG_CHANGED','Credentials changed while backing up.');await fs.unlink(authFile());backups.push(b.backup);}
 if(options.desktop){
  const p=desktopFile(options),b=await backupFile(p),cfg=JSON.parse(b.bytes);
  const headers=cfg.mcp?.servers?.[options.server||process.env.SEALSEEK_MEDIA_SERVER||'sealseek-canvas']?.headers;
  requireValue(headers,'CAPABILITY_UNAVAILABLE','Desktop media configuration is missing.');
  for(const key of Object.keys(headers))if(isCredentialHeader(key))delete headers[key];
  const tmp=p+'.'+crypto.randomUUID()+'.tmp';await createJson(tmp,cfg);
  requireValue(hash(await fs.readFile(p))===b.digest,'CONFIG_CHANGED','Desktop configuration changed during logout.');
  await fs.rename(tmp,p);await fs.chmod(p,b.mode);backups.push(b.backup);
 }
 await createJson(authFile(),{owner:META.name,version:1,endpoint:MEDIA_ENDPOINT,logged_out:true});
 return {ok:true,removed:true,backups};
}
