import fs from 'node:fs/promises';
import path from 'node:path';
import { requireValue, MediaError, secureUrl, hash } from './core.mjs';
import { toolFor, validateArguments, call } from './mcp.mjs';
import { validateModel } from './models.mjs';

const MIME = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
export async function reference(value) {
  if (/^https?:\/\//i.test(value)) return { url: secureUrl(value).href };
  const file = path.resolve(value), stat = await fs.stat(file).catch(() => null);
  requireValue(stat?.isFile() && stat.size > 0 && stat.size <= 30 * 1024 * 1024, 'INVALID_REFERENCE', 'A reference must be a readable image file of 1 byte to 30 MiB.');
  const mime = MIME[path.extname(file).toLowerCase()];
  requireValue(mime, 'INVALID_REFERENCE', 'Supported reference formats: PNG, JPEG, WebP, GIF.');
  const bytes = await fs.readFile(file);
  const valid = mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : mime === 'image/webp' ? bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' : /^GIF8[79]a/.test(bytes.toString('ascii',0,6));
  requireValue(valid, 'INVALID_REFERENCE', 'The image content does not match its extension.');
  return { file, mime, digest: hash(bytes), size: stat.size };
}
export async function prepare(kind, options, tools, catalog) {
  requireValue(['image','video'].includes(kind), 'INVALID_INPUT', 'Expected image or video.');
  requireValue(!(options.prompt && options['prompt-file']), 'INVALID_INPUT', 'Use prompt or prompt-file once.');
  const prompt = options['prompt-file'] ? await fs.readFile(path.resolve(options['prompt-file']), 'utf8') : options.prompt;
  requireValue(typeof prompt === 'string' && prompt.trim(), 'INVALID_INPUT', 'A prompt is required.');
  requireValue(options.model, 'INVALID_INPUT', 'Specify a model returned by capabilities --live.');
  const contract=validateModel(kind,options,{tools,catalog});
  const args = { prompt: prompt.trim(), model: options.model };
  if (!options.size) {args.aspect_ratio=options.ratio||contract.defaults.ratio;args.resolution=options.resolution||contract.defaults.resolution;}
  else {if(options.ratio)args.aspect_ratio=options.ratio;if(options.resolution)args.resolution=options.resolution;}
  if (options.size) { requireValue(kind === 'image', 'FEATURE_UNSUPPORTED', 'Pixel size is available for images only.'); args.size = options.size; }
  for (const [flag, name] of [['count','num'],['duration','duration']]) if (options[flag] !== undefined) {
    const value = Number(options[flag]); requireValue(Number.isInteger(value) && value > 0, 'INVALID_INPUT', `${flag} must be a positive integer.`);
    requireValue(kind === (flag === 'count' ? 'image' : 'video'), 'FEATURE_UNSUPPORTED', `${flag} is not supported for ${kind}.`); args[name] = value;
  }
  // Provider catalog choices supplement descriptive-only MCP schemas.
  if (kind === 'image') {
    args.num ??= 1;
    requireValue(args.num <= 4, 'FEATURE_UNSUPPORTED', 'Generate at most four images per request.');
    if (args.size) requireValue(/^[1-9]\d*x[1-9]\d*$/.test(args.size), 'INVALID_INPUT', 'Pixel size must use positive integers WxH.');
  } else {
    args.duration ??= contract.defaults.duration;
  }
  const refs = await Promise.all((options.reference || []).map(reference));
  if (refs.length) args.reference_images = refs.map(r => r.url || 'https://reference.invalid/pending-upload.png');
  const first = options.first ? await reference(options.first) : null, last = options.last ? await reference(options.last) : null;
  requireValue(kind === 'video' || (!first && !last), 'FEATURE_UNSUPPORTED', 'First and last frames are video inputs.');
  if (first) args.first_frame_image = first.url || 'https://reference.invalid/pending-upload.png';
  if (last) args.last_frame_image = last.url || 'https://reference.invalid/pending-upload.png';
  const tool = toolFor(tools, `generate_${kind}`); validateArguments(tool, args);
  if ([...refs, first, last].some(r => r?.file)) toolFor(tools, 'create_upload_urls');
  return { kind, tool: tool.name, args, refs, first, last, model_contract:contract, output: options.output ? path.resolve(options.output) : null };
}
function records(values, accept, output = []) {
  for (const value of values) {
    if (value && typeof value === 'object') {
      if (accept(value)) output.push(value);
      else for (const v of Object.values(value)) records([v], accept, output);
    }
  }
  return output;
}
export function signedUploadUrl(value) {
  const u = new URL(value);
  // OSS signatures bind the resource/query, not the transport scheme. Upgrade
  // the provider's legacy HTTP OSS endpoint without changing signed bytes.
  const candidate = u.protocol === 'http:' && /^[a-z0-9.-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(u.hostname)
    ? value.replace(/^http:/i,'https:') : value;
  secureUrl(candidate);
  return candidate;
}
export async function upload(connection, ref) {
  if (ref.url) return ref.url;
  const bytes = await fs.readFile(ref.file);
  requireValue(hash(bytes) === ref.digest, 'REFERENCE_CHANGED', 'A reference changed after validation. Prepare a new request.');
  const data = await call(connection, 'create_upload_urls', { files: [{ mime_type: ref.mime }] }, 30000);
  const item = records(data, v => typeof v.upload_url === 'string' && typeof v.file_url === 'string')[0];
  requireValue(item, 'OUTPUT_CONTRACT_FAILED', 'The upload tool returned no signed upload URL.');
  const uploadUrl = signedUploadUrl(item.upload_url); secureUrl(item.file_url);
  const response = await fetch(uploadUrl, { method: 'PUT', headers: item.headers || { 'Content-Type': ref.mime }, body: bytes, redirect: 'error', signal: AbortSignal.timeout(60000) });
  requireValue(response.ok, 'UPLOAD_FAILED', 'Reference upload failed.');
  return item.file_url;
}
export function mediaUrls(values, kind) {
  const out = new Set();
  const walk = value => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
        const candidate = match[0].replace(/[.,;]+$/, '');
        try { const u = secureUrl(candidate); if ((kind === 'image' ? /\.(png|jpe?g|webp|gif)$/i : /\.(mp4|webm|mov)$/i).test(u.pathname)) out.add(u.href); } catch {}
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  values.forEach(walk); return [...out];
}
export async function download(urls, kind, directory, id) {
  await fs.mkdir(directory, { recursive: true });
  const files = [];
  for (let i=0;i<urls.length;i++) {
    const u = secureUrl(urls[i]);
    const ext = path.extname(u.pathname).toLowerCase();
    const target = path.join(directory, `${kind === 'image' ? '图片' : '视频'}-${id.slice(0,8)}-${i+1}${ext}`);
    // Reserve before fetching; existing user files are never replaced.
    const handle = await fs.open(target, 'wx', 0o600).catch(e => { if (e.code === 'EEXIST') throw new MediaError('TARGET_EXISTS', 'A destination file already exists.'); throw e; });
    try {
      const response = await fetch(u, { signal: AbortSignal.timeout(120000) });
      requireValue(response.ok, 'DOWNLOAD_FAILED', 'The generated asset could not be downloaded.');
      const bytes = Buffer.from(await response.arrayBuffer());
      requireValue(bytes.length > 0 && !/text\/|application\/json/.test(response.headers.get('content-type') || ''), 'OUTPUT_CONTRACT_FAILED', 'The asset response is not media.');
      await handle.writeFile(bytes); files.push({ path: target, size: bytes.length, sha256: hash(bytes), mime_type: response.headers.get('content-type') });
    } finally { await handle.close(); }
  }
  return files;
}
export async function execute(connection, request, timeout) {
  const args = { ...request.args };
  if (request.refs.length) args.reference_images = await Promise.all(request.refs.map(r => upload(connection,r)));
  if (request.first) args.first_frame_image = await upload(connection, request.first);
  if (request.last) args.last_frame_image = await upload(connection, request.last);
  const values = await call(connection, request.tool, args, timeout);
  const urls = mediaUrls(values, request.kind);
  requireValue(urls.length, 'OUTPUT_CONTRACT_FAILED', 'The generation tool returned no usable media URL. Inspect history before resubmitting.');
  const messages=values.filter(v=>typeof v==='string').join('\n');
  const amount=/扣费[：:]\s*(\d+(?:\.\d+)?)\s*积分/.exec(messages);
  return { urls, requested_model: request.args.model, actual_model: null, count: urls.length,cost:amount?{amount:Number(amount[1]),unit:'SealSeek credits'}:null };
}
