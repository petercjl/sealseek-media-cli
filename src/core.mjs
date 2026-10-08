import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const META = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
export class MediaError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
export function requireValue(condition, code, message, details) {
  if (!condition) throw new MediaError(code, message, details);
}
export function stateRoot() { return path.resolve(process.env.SEALSEEK_MEDIA_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'sealseek-media')); }
export function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex'); }
export async function exists(p) { try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
export async function readJson(p) { return JSON.parse(await fs.readFile(p, 'utf8')); }
export async function createJson(p, value) {
  await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  await fs.writeFile(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
// Mutable state is package-owned and validated before each atomic replacement.
export async function replaceJob(p, value, {rename=fs.rename} = {}) {
  const current = await readJson(p);
  requireValue(current.owner === META.name && current.id === value.id, 'UNMANAGED_STATE', 'State ownership mismatch.');
  const tmp = `${p}.${crypto.randomUUID()}.tmp`;
  await createJson(tmp, value);
  // Windows readers and antivirus can briefly block an atomic replacement.
  // Keep the old file and complete temporary file intact while retrying rename.
  for(let attempt=0;;attempt++) {
    try { await rename(tmp,p);break; }
    catch(e) { if(!['EPERM','EBUSY','EACCES'].includes(e.code)||attempt>=7)throw e;await new Promise(r=>setTimeout(r,Math.min(20*2**attempt,200))); }
  }
}
export function publicError(e) {
  return { code: e.code && /^[A-Z_]+$/.test(e.code) ? e.code : 'PROVIDER_FAILURE', message: e instanceof MediaError ? e.message : 'Operation failed; inspect desktop authentication and task history before retrying.', ...(e.details ? { details: e.details } : {}) };
}
export function secureUrl(value) {
  let u; try { u = new URL(value); } catch { throw new MediaError('INVALID_URL', 'A valid HTTP(S) URL is required.'); }
  requireValue(!u.username && !u.password && (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))), 'INVALID_URL', 'HTTPS is required outside loopback.');
  return u;
}
export function parse(argv, allowed, repeat = []) {
  const options = {}, args = [];
  const boolean = new Set(['json','dry-run','submit','new','live','yes','force','desktop']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args.push(a); continue; }
    const [key, ...tail] = a.slice(2).split('=');
    requireValue(allowed.includes(key), 'UNKNOWN_OPTION', `Unknown option --${key}.`);
    const value = boolean.has(key) ? (tail.length ? tail.join('=') === 'true' : true) : (tail.length ? tail.join('=') : argv[++i]);
    requireValue(value !== undefined && (typeof value !== 'string' || !value.startsWith('--')), 'INVALID_INPUT', `Missing value for --${key}.`);
    if (repeat.includes(key)) (options[key] ||= []).push(value);
    else { requireValue(!(key in options), 'INVALID_INPUT', `Repeated option --${key}.`); options[key] = value; }
  }
  return { options, args };
}
