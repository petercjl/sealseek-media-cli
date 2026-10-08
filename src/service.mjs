import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { profile,authFile,MEDIA_ENDPOINT,isCredentialHeader,tokenMetadata } from './auth.mjs';
import { MediaError,requireValue,secureUrl,readJson } from './core.mjs';
export async function desktopConfig(options = {}) {
  if(options.authToken){return {url:secureUrl(MEDIA_ENDPOINT),headers:{Authorization:'Bearer '+options.authToken,token:options.authToken},source:'login-verification'};}
  if(!options.config&&!process.env.SEALSEEK_MEDIA_DESKTOP_CONFIG){
    const saved=await profile();
    if(saved){requireValue(!saved.logged_out,'AUTH_REQUIRED','SealSeek media is logged out. Run sealseek-media auth login.',{reason:'logged_out',login_command:'sealseek-media auth login --json'});const metadata=tokenMetadata(saved.token);requireValue(metadata.expired!==true,'AUTH_EXPIRED','SealSeek credentials have expired. Run sealseek-media auth login.',{login_command:'sealseek-media auth login --json'});return {url:secureUrl(saved.endpoint),headers:{Authorization:'Bearer '+saved.token,token:saved.token},source:'plugin-profile',configPath:authFile(),metadata};}
  }
  const configPath = path.resolve(options.config || process.env.SEALSEEK_MEDIA_DESKTOP_CONFIG || path.join(os.homedir(), '.sealseek', 'sealseek.json'));
  let cfg;
  try { cfg = await readJson(configPath); } catch { throw new MediaError('AUTH_REQUIRED', 'SealSeek desktop configuration is unavailable. Sign in to the desktop app or provide --config.'); }
  const servers = cfg.mcp?.servers || {};
  const key = options.server || process.env.SEALSEEK_MEDIA_SERVER || 'sealseek-canvas';
  const server = servers[key];
  requireValue(server && !server.disabled && server.enabled !== false && server.url, 'CAPABILITY_UNAVAILABLE', 'The selected SealSeek desktop media server is unavailable.');
  const url = secureUrl(server.url);
  const headers = server.headers || {};
  requireValue(Object.entries(headers).every(([k,v]) => typeof v === 'string' && !/[\r\n]/.test(k + v)), 'INVALID_CONFIG', 'Desktop media headers must be plain strings.');
  const credentials=Object.entries(headers).filter(([k,v])=>isCredentialHeader(k)&&v.trim());
  requireValue(credentials.length, 'AUTH_REQUIRED', 'SealSeek credentials are missing. Run sealseek-media auth login.',{reason:'missing',login_command:'sealseek-media auth login --json'});
  const metadata=tokenMetadata(credentials[0][1]);
  requireValue(metadata.expired!==true,'AUTH_EXPIRED','SealSeek credentials have expired. Run sealseek-media auth login.',{login_command:'sealseek-media auth login --json'});
  return { url, headers, configPath, server: key,source:'desktop-config',metadata };
}
export async function authenticatedFetch(url,init){
  const response=await fetch(url,init);
  let denied=[401,403].includes(response.status);
  if((response.headers.get('content-type')||'').includes('json')){try{const body=await response.clone().json();denied ||= [401,403].includes(body?.code)||[401,403].includes(body?.error?.code);}catch{}}
  requireValue(!denied,'AUTH_REJECTED','SealSeek rejected the credentials. Run sealseek-media auth login.',{login_command:'sealseek-media auth login --json'});
  return response;
}
export async function verifyCredentials(cfg){
  const r=await authenticatedFetch(new URL('/api/user/user/info',cfg.url.origin),{headers:cfg.headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  const b=await r.json();requireValue(r.ok&&b.code===200&&b.data,'AUTH_REJECTED','SealSeek rejected the login session. Log in again.',{login_command:'sealseek-media auth login --json'});
  return {verified:true};
}
export function sanitizeProviderText(value) {
  return String(value).replace(/https?:\/\/[^\s<>"']+/gi,'[redacted URL]')
    .replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted credential]')
    .replace(/((?:token|password|secret|cookie|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,'$1[redacted]')
    .replace(/[A-Za-z0-9_+/=-]{64,}/g,'[redacted opaque value]').slice(0,1500);
}
