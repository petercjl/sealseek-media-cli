import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { META,createJson } from '../src/core.mjs';
import { saveToken,logout,localAuthStatus,tokenMetadata,authFile } from '../src/auth.mjs';
import { desktopConfig,authenticatedFetch } from '../src/service.mjs';
import { serveLogin,loginPath,loginStatus } from '../src/auth-web.mjs';
const jwt=exp=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({iat:1700000000,exp})).toString('base64url')+'.fixture-signature';

test('credential expiry, private backup/removal, managed profile and unrelated config preservation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-auth-test-'));
 const prev={state:process.env.SEALSEEK_MEDIA_STATE_DIR,auth:process.env.SEALSEEK_MEDIA_AUTH_FILE};
 process.env.SEALSEEK_MEDIA_STATE_DIR=path.join(dir,'state');process.env.SEALSEEK_MEDIA_AUTH_FILE=path.join(dir,'auth.json');
 try{
  const config=path.join(dir,'desktop.json'),token=jwt(Math.floor(Date.now()/1000)+600);
  const cfg={unrelated:{value:'preserve'},mcp:{servers:{'sealseek-canvas':{url:'https://example.com/mcp',headers:{Authorization:'Bearer '+token,token,Accept:'application/json'}}}}};
  await fs.writeFile(config,JSON.stringify(cfg),{mode:0o600});
  assert.equal((await localAuthStatus({config})).expired,false);
  await assert.rejects(logout({config,desktop:true}),{code:'PERMISSION_REQUIRED'});
  const removed=await logout({config,desktop:true,yes:true});assert.equal(removed.backups.length,1);
  assert.deepEqual(JSON.parse(await fs.readFile(removed.backups[0],'utf8')),cfg);
  const after=JSON.parse(await fs.readFile(config,'utf8'));assert.deepEqual(after.unrelated,cfg.unrelated);assert.deepEqual(after.mcp.servers['sealseek-canvas'].headers,{Accept:'application/json'});
  await assert.rejects(desktopConfig({config}),{code:'AUTH_REQUIRED'});
  assert.equal(tokenMetadata(jwt(1)).expired,true);
  await assert.rejects(saveToken(jwt(1)),{code:'AUTH_EXPIRED'});
  const saved=await saveToken(token);assert(saved.credential_file);assert.equal((await localAuthStatus()).source,'plugin-profile');
  if(process.platform!=='win32')assert.equal((await fs.stat(authFile())).mode&0o777,0o600);
  const updated=await saveToken(jwt(Math.floor(Date.now()/1000)+1200));assert(updated.backup);
  await logout({yes:true});assert.equal((await localAuthStatus()).present,false);assert(!JSON.stringify(JSON.parse(await fs.readFile(authFile(),'utf8'))).includes(token));await assert.rejects(desktopConfig(),{code:'AUTH_REQUIRED'});
 }finally{for(const [key,value]of [['SEALSEEK_MEDIA_STATE_DIR',prev.state],['SEALSEEK_MEDIA_AUTH_FILE',prev.auth]])if(value===undefined)delete process.env[key];else process.env[key]=value;await fs.rm(dir,{recursive:true,force:true});}
});

test('HTTP 200 business 401 is an authentication rejection',async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:401,message:'fixture expired'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await assert.rejects(authenticatedFetch('http://127.0.0.1:'+server.address().port,{}),{code:'AUTH_REJECTED'});}finally{await new Promise(r=>server.close(r));}
});

test('official QR contract: pending, verified token storage, private page and terminal success',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-qr-test-')),prev=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=dir;
 const token=jwt(Math.floor(Date.now()/1000)+600);let allow=false,verified=false,saved=false;
 const mock=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data:req.url.includes('getQrParams')?{ticket:'fixture-ticket-for-test',qrCodeUrl:'https://open.weixin.qq.com/connect/qrconnect?appid=fixture'}:allow?{status:'success',token}:{status:'pending'}}));});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));let handle;
 try{
  const id=crypto.randomUUID();await createJson(loginPath(id),{owner:META.name,id,status:'starting'});
  handle=await serveLogin(id,{base:'http://127.0.0.1:'+mock.address().port,interval:20,verify:async value=>{assert.equal(value,token);verified=true;},save:async value=>{assert(verified);assert.equal(value,token);saved=true;return {credential_file:'fixture',expires_at:null};}});
  const session=await loginStatus(id),response=await fetch(session.login_url);assert.equal(response.status,200);
  const html=await response.text();assert(html.includes('微信官方登录二维码'));assert(!html.includes(token));assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(new URL('/unauthorized',session.login_url))).status,404);
  assert.equal(saved,false);allow=true;
  for(let i=0;i<100;i++){if(['succeeded','failed','expired'].includes((await loginStatus(id)).status))break;await new Promise(r=>setTimeout(r,20));}
  const terminal=await loginStatus(id);assert.equal(terminal.status,'succeeded',JSON.stringify(terminal.error));assert(saved);assert(!JSON.stringify(await loginStatus(id)).includes(token));
 }finally{handle?.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));if(prev===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=prev;await fs.rm(dir,{recursive:true,force:true});}
});

test('QR failure, missing account binding and expiry never store credentials',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-qr-negative-')),prev=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=dir;
 let scenario='noRelated',saved=0;
 const mock=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data:req.url.includes('getQrParams')?{ticket:'fixture-ticket-for-test',qrCodeUrl:'https://open.weixin.qq.com/connect/qrconnect?appid=fixture'}:{status:scenario,token:jwt(Math.floor(Date.now()/1000)+600)}}));});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 try{
  for(const [input,expected]of [['noRelated','binding_required'],['expired','expired'],['success','failed']]){
   scenario=input;const id=crypto.randomUUID();await createJson(loginPath(id),{owner:META.name,id,status:'starting'});
   let renewals=0;
   const h=await serveLogin(id,{base:'http://127.0.0.1:'+mock.address().port,verify:async()=>{throw Error('fixture permission failure');},save:async()=>{saved++;return {};},renew:async()=>{renewals++;return {status:'pending',login_url:'http://127.0.0.1:12345/fixture-next'};}});
   try{
    const session=await loginStatus(id);assert.equal(session.status,expected);
    const page=await fetch(session.login_url);assert.equal(page.status,200);assert((await page.text()).includes('重新获取二维码'));
    const url=session.login_url+'/renew';assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);assert.equal(renewals,0);
    const next=await fetch(url,{method:'POST',headers:{Origin:new URL(session.login_url).origin}});assert.equal(next.status,200);assert.equal((await next.json()).login_url,'http://127.0.0.1:12345/fixture-next');assert.equal(renewals,1);
   }finally{h.close();}
  }
  assert.equal(saved,0);
 }finally{mock.closeAllConnections();await new Promise(r=>mock.close(r));if(prev===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=prev;await fs.rm(dir,{recursive:true,force:true});}
});

test('SMS client login uses official device channel, verifies before storage and never exposes token',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sealseek-sms-test-')),prev=process.env.SEALSEEK_MEDIA_STATE_DIR;process.env.SEALSEEK_MEDIA_STATE_DIR=dir;
 const token=jwt(Math.floor(Date.now()/1000)+600);let verified=false,saved=false,sends=0,loginBody;
 const mock=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  if(req.url.includes('getQrParams'))assert.fail('SMS login must not create a QR session');
  if(req.url.includes('sendCode'))sends++;
  if(req.url.includes('phoneAndVerifyCodeLogin'))loginBody=JSON.parse(raw);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data:loginBody?{token}:true}));
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));let h;
 try{
  const id=crypto.randomUUID();await createJson(loginPath(id),{owner:META.name,id,status:'starting',device_type:'CLIENT',login_preference:'sms'});
  h=await serveLogin(id,{base:'http://127.0.0.1:'+mock.address().port,verify:async v=>{assert.equal(v,token);verified=true;},save:async(v,metadata)=>{assert(verified);assert.equal(v,token);assert.deepEqual(metadata,{deviceType:'CLIENT',method:'sms'});saved=true;return {};}});
  const session=await loginStatus(id),origin=new URL(session.login_url).origin;
  const post=(action,body,source=origin)=>fetch(session.login_url+'/sms/'+action,{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const phone='13800000000';assert.equal((await post('send',{phone},'https://untrusted.example')).status,403);assert.equal(sends,0);
  assert.equal((await post('send',{phone})).status,200);assert.equal(sends,1);
  const response=await post('login',{phone,code:'123456'});assert.equal(response.status,200);assert(!(await response.text()).includes(token));
  assert.equal(loginBody.deviceType,'CLIENT');assert(saved);assert.equal((await loginStatus(id)).login_method,'sms');assert(!JSON.stringify(await loginStatus(id)).includes(token));
 }finally{h?.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));if(prev===undefined)delete process.env.SEALSEEK_MEDIA_STATE_DIR;else process.env.SEALSEEK_MEDIA_STATE_DIR=prev;await fs.rm(dir,{recursive:true,force:true});}
});
