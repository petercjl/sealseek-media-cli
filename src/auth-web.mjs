import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT,META,stateRoot,createJson,readJson,replaceJob,requireValue,publicError } from './core.mjs';
import { PROVIDER,saveToken } from './auth.mjs';

export function loginPath(id){requireValue(/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id),'INVALID_INPUT','Expected a login UUID.');return path.join(stateRoot(),'auth-sessions',id+'.json');}
export async function loginStatus(id){const v=await readJson(loginPath(id));requireValue(v.owner===META.name&&v.id===id,'UNMANAGED_STATE','Login session ownership mismatch.');const {owner,...safe}=v;return safe;}
export async function providerJson(route,base=PROVIDER){
 const response=await fetch(base+route,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
 requireValue(response.ok,'LOGIN_SERVICE_FAILED','SealSeek login service is unavailable.');
 const value=await response.json();requireValue(value.code===200,'LOGIN_SERVICE_FAILED','SealSeek login service rejected the request.');return value.data;
}
export async function qrParams(base=PROVIDER){const v=await providerJson('/api/user/login/getQrParams?deviceType=WEB',base);requireValue(typeof v?.qrCodeUrl==='string'&&typeof v.ticket==='string','LOGIN_CONTRACT_FAILED','The provider returned unsupported QR login parameters.');let u;try{u=new URL(v.qrCodeUrl);}catch{requireValue(false,'LOGIN_CONTRACT_FAILED','The provider returned an invalid QR URL.');}requireValue(u.protocol==='https:'&&u.hostname==='open.weixin.qq.com'&&u.pathname==='/connect/qrconnect'&&!u.username&&!u.password&&v.ticket.length>10,'LOGIN_CONTRACT_FAILED','The provider returned unsupported QR login parameters.');return v;}
export async function startLogin(){
 const id=crypto.randomUUID(),value={owner:META.name,id,status:'starting',created_at:new Date().toISOString()};await createJson(loginPath(id),value);
 const child=spawn(process.execPath,[path.join(ROOT,'bin','sealseek-media.mjs'),'_auth-worker',id],{detached:true,stdio:'ignore',env:process.env});
 await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});child.unref();
 const end=Date.now()+15000;while(Date.now()<end){const v=await loginStatus(id);if(v.status!=='starting')return v;await new Promise(r=>setTimeout(r,250));}return loginStatus(id);
}
export async function serveLogin(id,{base=PROVIDER,verify,save=saveToken,interval=2000,lifetime=300000,renew=startLogin}={}) {
 const p=loginPath(id),job=await readJson(p);requireValue(job.owner===META.name&&job.status==='starting','UNMANAGED_STATE','Expected an unstarted managed login session.');
 const secret=crypto.randomBytes(24).toString('hex');let server,timer,expiry,inFlight=false,params;
 const commit=async()=>replaceJob(p,job);
 const finish=async(status,error)=>{clearInterval(timer);clearTimeout(expiry);job.status=status;if(error)job.error=publicError(error);await commit();expiry=setTimeout(()=>server?.close(),1800000);};
 try{
  params=await qrParams(base);
  server=http.createServer(async(req,res)=>{
   const host='127.0.0.1:'+server.address().port;
   res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
   if(req.headers.host!==host||!req.url.startsWith('/'+secret)){res.writeHead(404);res.end();return;}
   if(req.method==='POST'&&req.url==='/'+secret+'/renew'){
    res.setHeader('Content-Type','application/json');
    if(req.headers.origin!=='http://'+host){res.writeHead(403);res.end(JSON.stringify({error:'INVALID_ORIGIN'}));return;}
    if(!['expired','failed','binding_required'].includes(job.status)){res.writeHead(409);res.end(JSON.stringify({error:'LOGIN_STILL_ACTIVE'}));return;}
    try{const next=await renew();requireValue(next.status==='pending'&&typeof next.login_url==='string','LOGIN_SERVICE_FAILED','A new login session could not be started.');res.end(JSON.stringify({login_url:next.login_url}));}catch(e){res.writeHead(503);res.end(JSON.stringify({error:publicError(e).code}));}return;
   }
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   if(req.url==='/'+secret+'/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:job.status,error:job.error?.code}));return;}
   if(req.url!=='/'+secret){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.setHeader('Content-Security-Policy',"default-src 'none'; frame-src https://open.weixin.qq.com https://gateway.sealseek.cn; style-src 'unsafe-inline'; script-src 'nonce-"+secret+"'; connect-src 'self'; base-uri 'none'; form-action 'none'");
   const qrUrl=new URL(params.qrCodeUrl);qrUrl.searchParams.set('login_type','jssdk');qrUrl.searchParams.set('self_redirect','true');
   const qr=qrUrl.href.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
   res.end(`<!doctype html><meta charset="utf-8"><title>SealSeek 媒体工具授权</title><style>body{font:16px system-ui;background:#f3f6fa;color:#17283b;max-width:620px;margin:48px auto;padding:24px}main{background:white;padding:32px;border-radius:18px}iframe{width:340px;height:420px;border:0;display:block;margin:auto}p{line-height:1.7}#status{padding:14px;background:#eef5ff;border-radius:8px}</style><main><h1>SealSeek 媒体工具授权</h1><p>请用微信扫描官方二维码，登录您已有的 SealSeek 账号。确认后，本机 CLI 将获得您的 SealSeek 登录凭据，用于已授权的媒体操作。</p><iframe src="${qr}" title="微信官方登录二维码" referrerpolicy="no-referrer"></iframe><p id="status">等待扫码与确认…</p><button id="renew" hidden>重新获取二维码</button><p>凭据仅保存在本机，页面不接收密码，也不展示 token。新账号或需要绑定手机号时，请先到 <a href="https://sealseek.cn/login/#/" target="_blank" rel="noreferrer">SealSeek 官方登录页</a>完成，再重新运行 auth login。</p></main><script nonce="${secret}">const labels={pending:'等待扫码与确认…',verifying:'登录成功，正在验证媒体权限…',succeeded:'授权完成，可以关闭此页面并回到 Agent。',expired:'二维码已过期，请点击下方按钮重新获取。',binding_required:'请先在官方登录页完成账号绑定，然后重新授权。',failed:'授权失败，请回到 CLI 查看错误。'};document.getElementById('renew').onclick=async()=>{const b=document.getElementById('renew');b.disabled=true;try{const r=await fetch(location.pathname+'/renew',{method:'POST'});const v=await r.json();if(!r.ok||!v.login_url)throw Error();location.assign(v.login_url)}catch{document.getElementById('status').textContent='重新获取失败，请运行 sealseek-media auth login。';b.disabled=false}};async function poll(){try{let r=await fetch(location.pathname+'/status');let v=await r.json();document.getElementById('status').textContent=labels[v.status]||v.status;document.getElementById('renew').hidden=!['expired','failed','binding_required'].includes(v.status);if(['pending','verifying'].includes(v.status))setTimeout(poll,2000)}catch{document.getElementById('status').textContent='授权会话已结束，请回到 CLI 查看状态。'}}poll();</script>`);
  });
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  job.status='pending';job.login_url='http://127.0.0.1:'+server.address().port+'/'+secret;job.expires_at=new Date(Date.now()+lifetime).toISOString();job.pid=process.pid;await commit();
  const check=async()=>{if(inFlight||job.status!=='pending')return;inFlight=true;try{
   const v=await providerJson('/api/user/login/wxLoginStatus?ticket='+encodeURIComponent(params.ticket),base);
   if(v.status==='success'){job.status='verifying';await commit();requireValue(typeof v.token==='string','LOGIN_CONTRACT_FAILED','The provider returned no login token.');await verify(v.token);requireValue(job.status==='verifying','LOGIN_EXPIRED','Login session expired during verification.');const saved=await save(v.token);job.credential_file=saved.credential_file;job.token_expires_at=saved.expires_at;await finish('succeeded');}
   else if(v.status==='expired')await finish('expired');else if(v.status==='noRelated')await finish('binding_required');else requireValue(v.status==='pending','LOGIN_CONTRACT_FAILED','Unexpected provider login status.');
  }catch(e){await finish('failed',e);}finally{inFlight=false;}};
  timer=setInterval(check,interval);expiry=setTimeout(()=>{void finish('expired');},lifetime);await check();
 }catch(e){job.status='failed';job.error=publicError(e);await commit();server?.close();}
 return {server,job,close:()=>{clearInterval(timer);clearTimeout(expiry);server?.close();}};
}
