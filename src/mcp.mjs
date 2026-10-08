import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Ajv from 'ajv';
import { profile,authFile,MEDIA_ENDPOINT,isCredentialHeader,tokenMetadata } from './auth.mjs';
import { META, MediaError, requireValue, secureUrl, readJson } from './core.mjs';

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
export async function connect(options = {}) {
  const cfg = await desktopConfig(options);
  const client = new Client({ name: META.name, version: META.version });
  const transport = new StreamableHTTPClientTransport(cfg.url, { fetch:authenticatedFetch,requestInit: { headers: cfg.headers }, redirectPolicy: 'same-origin', reconnectionOptions: { maxReconnectionDelay: 3000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 } });
  try {
    await client.connect(transport, { timeout: 20000 });
    const tools = []; let cursor;
    do { const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 20000 }); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
    return { client, tools, cfg, close: () => client.close() };
  } catch (e) {
    await client.close().catch(() => {});
    if(e instanceof MediaError)throw e;
    throw new MediaError(e.code === 401 || e.code === 403 ? 'AUTH_REQUIRED' : 'CONNECTION_FAILED', 'SealSeek media discovery failed. Check desktop sign-in and network access.');
  }
}
export function toolFor(tools, name) {
  const tool = tools.find(t => t.name === name);
  requireValue(tool, 'CAPABILITY_UNAVAILABLE', `Desktop tool ${name} is unavailable.`);
  return tool;
}
export function validateArguments(tool, args) {
  const schema = { ...tool.inputSchema, additionalProperties: false };
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  requireValue(validate(args), 'FEATURE_UNSUPPORTED', 'The request does not match the current desktop tool schema.', { fields: (validate.errors || []).map(e => ({ path: e.instancePath, keyword: e.keyword, message: e.message })) });
}
export function sanitizeProviderText(value) {
  return String(value).replace(/https?:\/\/[^\s<>"']+/gi,'[redacted URL]')
    .replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted credential]')
    .replace(/((?:token|password|secret|cookie|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,'$1[redacted]')
    .replace(/[A-Za-z0-9_+/=-]{64,}/g,'[redacted opaque value]').slice(0,1500);
}
export function unwrap(result) {
  if(result.isError) {
    const text=sanitizeProviderText((result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')||result.structuredContent?.message||result.structuredContent?.error?.message||'SealSeek returned a tool error.');
    const parameterError=/参数配置|任务类型约束|不支持.*参数|unsupported.*param|invalid.*param/i.test(text);
    throw new MediaError(parameterError?'PROVIDER_PARAMETER_REJECTED':'PROVIDER_FAILURE','SealSeek rejected the tool request. See the sanitized provider error and task diagnosis.',{provider_text:text,retry_automatically:false,next_action:'Use task diagnose TASK_ID --json and inspect history. Changing a failed request is a new generation, not a read-only probe.'});
  }
  const values = [];
  if (result.structuredContent) values.push(result.structuredContent);
  for (const c of result.content || []) {
    if (c.type === 'text') { try { values.push(JSON.parse(c.text)); } catch { values.push(c.text); } }
  }
  return values;
}
export async function call(connection, name, args, timeout = 900000) {
  const tool = toolFor(connection.tools, name);
  validateArguments(tool, args);
  try { return unwrap(await connection.client.callTool({ name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout })); }
  catch (e) { if (e instanceof MediaError) throw e; throw new MediaError('SUBMISSION_UNCERTAIN', 'The media tool connection ended without a verified result. Inspect history; do not submit again automatically.',{transport_code:typeof e.code==='number'?e.code:null,transport_error:sanitizeProviderText(e.message||'Connection ended.'),retry_automatically:false}); }
}
