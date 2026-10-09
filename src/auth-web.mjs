import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT,META,stateRoot,createJson,readJson,replaceJob,requireValue,publicError } from './core.mjs';
import { PROVIDER,saveToken } from './auth.mjs';

export function loginPath(id){requireValue(/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id),'INVALID_INPUT','Expected a login UUID.');return path.join(stateRoot(),'auth-sessions',id+'.json');}
export async function loginStatus(id){const v=await readJson(loginPath(id));requireValue(v.owner===META.name&&v.id===id,'UNMANAGED_STATE','Login session ownership mismatch.');const {owner,...safe}=v;return safe;}
export async function providerJson(route,base=PROVIDER,init={}){
 const response=await fetch(base+route,{...init,headers:{Accept:'application/json',...init.headers},redirect:'error',signal:AbortSignal.timeout(15000)});
 requireValue(response.ok,'LOGIN_SERVICE_FAILED','SealSeek login service is unavailable.');
 const value=await response.json();requireValue(value.code===200,'LOGIN_SERVICE_FAILED','SealSeek login service rejected the request.');return value.data;
}
export async function qrParams(base=PROVIDER,deviceType='CLIENT'){requireValue(['CLIENT','WEB'].includes(deviceType),'INVALID_INPUT','Login device must be CLIENT or WEB.');const v=await providerJson('/api/user/login/getQrParams?deviceType='+deviceType,base);requireValue(typeof v?.qrCodeUrl==='string'&&typeof v.ticket==='string','LOGIN_CONTRACT_FAILED','The provider returned unsupported QR login parameters.');let u;try{u=new URL(v.qrCodeUrl);}catch{requireValue(false,'LOGIN_CONTRACT_FAILED','The provider returned an invalid QR URL.');}requireValue(u.protocol==='https:'&&u.hostname==='open.weixin.qq.com'&&u.pathname==='/connect/qrconnect'&&!u.username&&!u.password&&v.ticket.length>10,'LOGIN_CONTRACT_FAILED','The provider returned unsupported QR login parameters.');return v;}
export async function startLogin({device='client',method='sms',channel='plugin'}={}){
 requireValue(method==='sms','FEATURE_UNSUPPORTED','CLI authorization uses PLUGIN SMS login.');
 requireValue(device==='client','FEATURE_UNSUPPORTED','CLI authorization uses the PLUGIN channel with a fixed device type.');
 requireValue(channel==='plugin','INVALID_INPUT','CLI authorization uses the PLUGIN channel.');
 const id=crypto.randomUUID(),value={owner:META.name,id,status:'starting',login_channel:channel.toUpperCase(),device_type:device.toUpperCase(),login_preference:method,created_at:new Date().toISOString()};await createJson(loginPath(id),value);
 const child=spawn(process.execPath,[path.join(ROOT,'bin','sealseek-media.mjs'),'_auth-worker',id],{detached:true,stdio:'ignore',env:process.env});
 await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});child.unref();
 const end=Date.now()+15000;while(Date.now()<end){const v=await loginStatus(id);if(v.status!=='starting')return v;await new Promise(r=>setTimeout(r,250));}return loginStatus(id);
}
export async function serveLogin(id,{base=PROVIDER,verify,save=saveToken,interval=2000,lifetime=300000,renew=startLogin}={}) {
 const p=loginPath(id),job=await readJson(p);requireValue(job.owner===META.name&&job.status==='starting','UNMANAGED_STATE','Expected an unstarted managed login session.');
 const channel=job.login_channel||'SEALSEEK';
 requireValue(['SEALSEEK','PLUGIN'].includes(channel)&&!(channel==='PLUGIN'&&job.login_preference!=='sms'),'INVALID_INPUT','Unsupported login channel or method.');
 const secret=crypto.randomBytes(24).toString('hex');let server,timer,expiry,inFlight=false,params;
 const commit=async()=>replaceJob(p,job);
 const finish=async(status,error)=>{clearInterval(timer);clearTimeout(expiry);job.status=status;if(error)job.error=publicError(error);await commit();expiry=setTimeout(()=>server?.close(),1800000);};
 try{
  if(job.login_preference!=='sms')params=await qrParams(base,job.device_type||'CLIENT');
  server=http.createServer(async(req,res)=>{
   const host='127.0.0.1:'+server.address().port;
   res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
   if(req.headers.host!==host||!req.url.startsWith('/'+secret)){res.writeHead(404);res.end();return;}
   if(req.method==='POST'&&['/'+secret+'/sms/send','/'+secret+'/sms/login'].includes(req.url)){
    res.setHeader('Content-Type','application/json');
    if(req.headers.origin!=='http://'+host){res.writeHead(403);res.end(JSON.stringify({error:'INVALID_ORIGIN'}));return;}
    if(job.status!=='pending'){res.writeHead(409);res.end(JSON.stringify({error:'LOGIN_NOT_PENDING'}));return;}
    try{
     let raw='';for await(const chunk of req){raw+=chunk;requireValue(raw.length<=4096,'INVALID_INPUT','Login input is too large.');}
     const input=JSON.parse(raw);requireValue(typeof input.phone==='string'&&/^1[3-9]\d{9}$/.test(input.phone),'INVALID_INPUT','Enter a valid mobile phone number.');
     if(req.url.endsWith('/send')){await providerJson('/api/user/login/sendCode?phone='+encodeURIComponent(input.phone)+'&channel='+channel,base);res.end(JSON.stringify({ok:true}));return;}
     requireValue(typeof input.code==='string'&&/^\d{4,8}$/.test(input.code),'INVALID_INPUT','Enter the received verification code.');
     job.status='verifying';await commit();
     const value=await providerJson('/api/user/login/phoneAndVerifyCodeLogin',base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel,phone:input.phone,code:input.code,deviceType:job.device_type||'CLIENT'})});
     const token=typeof value==='string'?value:value?.token??value?.jwt;
     requireValue(typeof token==='string','LOGIN_CONTRACT_FAILED','The provider returned no supported login credential.');
     await verify(token);const saved=await save(token,{channel,deviceType:job.device_type||'CLIENT',method:'sms'});job.credential_file=saved.credential_file;job.token_expires_at=saved.expires_at;job.login_method='sms';await finish('succeeded');res.end(JSON.stringify({ok:true}));
    }catch(e){if(job.status==='verifying'){job.status='pending';await commit();}res.writeHead(400);res.end(JSON.stringify({error:publicError(e).code}));}return;
   }
   if(req.method==='POST'&&req.url==='/'+secret+'/renew'){
    res.setHeader('Content-Type','application/json');
    if(req.headers.origin!=='http://'+host){res.writeHead(403);res.end(JSON.stringify({error:'INVALID_ORIGIN'}));return;}
    if(!['expired','failed','binding_required'].includes(job.status)){res.writeHead(409);res.end(JSON.stringify({error:'LOGIN_STILL_ACTIVE'}));return;}
    try{const next=await renew({channel:channel.toLowerCase(),device:(job.device_type||'CLIENT').toLowerCase(),method:job.login_preference||'wechat'});requireValue(next.status==='pending'&&typeof next.login_url==='string','LOGIN_SERVICE_FAILED','A new login session could not be started.');res.end(JSON.stringify({login_url:next.login_url}));}catch(e){res.writeHead(503);res.end(JSON.stringify({error:publicError(e).code}));}return;
   }
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   if(req.url==='/'+secret+'/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:job.status,error:job.error?.code}));return;}
   if(req.url!=='/'+secret){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.setHeader('Content-Security-Policy',"default-src 'none'; frame-src https://open.weixin.qq.com https://gateway.sealseek.cn; style-src 'unsafe-inline'; script-src 'nonce-"+secret+"'; connect-src 'self'; base-uri 'none'; form-action 'none'");
   const qrUrl=params?new URL(params.qrCodeUrl):null;if(qrUrl){qrUrl.searchParams.set('login_type','jssdk');qrUrl.searchParams.set('self_redirect','true');}
   const qr=(qrUrl?.href||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
   res.end(`<!doctype html><meta charset="utf-8"><title>SealSeek 媒体工具授权</title><style>body{font:16px system-ui;background:#f3f6fa;color:#17283b;max-width:620px;margin:48px auto;padding:24px}main{background:white;padding:32px;border-radius:18px}iframe{width:340px;height:420px;border:0;display:block;margin:auto}p{line-height:1.7}#status{padding:14px;background:#eef5ff;border-radius:8px}</style><main><h1>SealSeek 媒体工具授权</h1><p>登录您已有的 SealSeek 账号，授权本机 CLI 使用生图生视频能力。</p>${params?`<iframe src="${qr}" title="微信官方登录二维码" referrerpolicy="no-referrer"></iframe>`:''}<p>CLI 使用 ${channel} 渠道 / ${(job.device_type||'CLIENT')} 设备类型。${channel==='PLUGIN'?'使用独立的插件授权，与网页及桌面端分别保持登录。':'为与网页端同时保持登录，优先使用手机号验证码。'}</p><details open><summary>手机号验证码登录</summary><p><input id="phone" type="tel" autocomplete="tel" placeholder="手机号"><button id="sendSms">发送验证码</button></p><p><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="验证码"><button id="loginSms">登录并授权 CLI</button></p><p id="smsStatus"></p></details><p id="status">等待扫码或验证码登录…</p><button id="renew" hidden>重新获取二维码</button><p>凭据仅保存在本机，页面不接收密码，也不展示 token。新账号或需要绑定手机号时，请先到 <a href="https://sealseek.cn/login/#/" target="_blank" rel="noreferrer">SealSeek 官方登录页</a>完成，再重新运行 auth login。</p></main><script nonce="${secret}">async function sms(action){const p=document.getElementById('smsStatus');p.textContent='处理中…';try{const r=await fetch(location.pathname+'/sms/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:document.getElementById('phone').value.trim(),code:document.getElementById('code').value.trim()})});const v=await r.json();if(!r.ok)throw Error(v.error||'LOGIN_FAILED');p.textContent=action==='send'?'验证码已发送':'授权完成';if(action==='send'){const b=document.getElementById('sendSms');b.disabled=true;setTimeout(()=>b.disabled=false,60000)}}catch(e){p.textContent='操作失败：'+e.message}}document.getElementById('sendSms').onclick=()=>sms('send');document.getElementById('loginSms').onclick=()=>sms('login');const labels={pending:'等待扫码与确认…',verifying:'登录成功，正在验证媒体权限…',succeeded:'授权完成，可以关闭此页面并回到 Agent。',expired:'二维码已过期，请点击下方按钮重新获取。',binding_required:'请先在官方登录页完成账号绑定，然后重新授权。',failed:'授权失败，请回到 CLI 查看错误。'};document.getElementById('renew').onclick=async()=>{const b=document.getElementById('renew');b.disabled=true;try{const r=await fetch(location.pathname+'/renew',{method:'POST'});const v=await r.json();if(!r.ok||!v.login_url)throw Error();location.assign(v.login_url)}catch{document.getElementById('status').textContent='重新获取失败，请运行 sealseek-media auth login。';b.disabled=false}};async function poll(){try{let r=await fetch(location.pathname+'/status');let v=await r.json();document.getElementById('status').textContent=labels[v.status]||v.status;document.getElementById('renew').hidden=!['expired','failed','binding_required'].includes(v.status);if(['pending','verifying'].includes(v.status))setTimeout(poll,2000)}catch{document.getElementById('status').textContent='授权会话已结束，请回到 CLI 查看状态。'}}poll();</script>`);
  });
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  job.status='pending';job.login_url='http://127.0.0.1:'+server.address().port+'/'+secret;job.expires_at=new Date(Date.now()+lifetime).toISOString();job.pid=process.pid;await commit();
  const check=async()=>{if(!params||inFlight||job.status!=='pending')return;inFlight=true;try{
   const v=await providerJson('/api/user/login/wxLoginStatus?ticket='+encodeURIComponent(params.ticket),base);
   if(job.status!=='pending')return;
   if(v.status==='success'){job.status='verifying';await commit();requireValue(typeof v.token==='string','LOGIN_CONTRACT_FAILED','The provider returned no login token.');await verify(v.token);requireValue(job.status==='verifying','LOGIN_EXPIRED','Login session expired during verification.');const saved=await save(v.token,{channel,deviceType:job.device_type||'CLIENT',method:'wechat'});job.login_method='wechat';job.credential_file=saved.credential_file;job.token_expires_at=saved.expires_at;await finish('succeeded');}
   else if(v.status==='expired')await finish('expired');else if(v.status==='noRelated')await finish('binding_required');else requireValue(v.status==='pending','LOGIN_CONTRACT_FAILED','Unexpected provider login status.');
  }catch(e){await finish('failed',e);}finally{inFlight=false;}};
  timer=setInterval(check,interval);expiry=setTimeout(()=>{void finish('expired');},lifetime);await check();
 }catch(e){job.status='failed';job.error=publicError(e);await commit();server?.close();}
 return {server,job,close:()=>{clearInterval(timer);clearTimeout(expiry);server?.close();}};
}
