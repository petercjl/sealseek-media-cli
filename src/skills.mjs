import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ROOT, META, exists, requireValue, hash, createJson, readJson, stateRoot } from './core.mjs';

export const SOURCE = path.join(ROOT, 'skills', 'sealseek-media');
const ROOTS = { codex:'.codex', workbuddy:'.workbuddy', sealseek:'.sealseek' };
export const INSTALLATION = {
  named_agents: Object.keys(ROOTS), fallback_agent: 'generic', custom_path_required: true,
  target_resolution: 'Use a named adapter when present; other valid Agent names use generic with an explicit --path.',
  directory_resolution: 'The calling Agent resolves its own advertised/configured Skill directory. The package does not scan other Agents.',
  commands: {
    install: 'sealseek-media skill install --agent generic --path <own-skill-directory>/sealseek-media --json',
    status: 'sealseek-media skill status --agent generic --path <own-skill-directory>/sealseek-media --json',
    update: 'sealseek-media skill update --agent generic --path <own-skill-directory>/sealseek-media --json'
  },
  update_scope: 'Current Agent only. Bind ordinary invocations with --agent and --skill-path, or SEALSEEK_MEDIA_AGENT and SEALSEEK_MEDIA_SKILL_PATH. Existing managed Skills are reconciled even when the package is current or the registry check is cached.',
  invocation: { agent_flag:'--agent', path_flag:'--skill-path', agent_env:'SEALSEEK_MEDIA_AGENT', path_env:'SEALSEEK_MEDIA_SKILL_PATH', precedence:'explicit flags replace environment selection', unspecified:'no Agent Skill directories scanned or synchronized' }
};
const MARKER = '.sealseek-media-install.json';
export function renderSkill(text, agent) { return text; }
export function destination(agent = 'generic', custom) {
  requireValue(typeof agent === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(agent), 'INVALID_TARGET', 'Agent must be a lowercase name containing letters, digits or hyphens.');
  const named = Object.hasOwn(ROOTS, agent);
  requireValue(custom !== undefined || named, 'TARGET_PATH_REQUIRED', 'Resolve this Agent\'s own Skill directory and pass --path <directory>/sealseek-media. Named adapters are optional; other Agents use generic.', { agent, fallback_agent:'generic' });
  if (custom !== undefined) {
    requireValue(typeof custom === 'string' && custom.trim().length > 0, 'INVALID_INPUT', '--path requires a nonempty directory.');
    return path.resolve(custom);
  }
  return path.join(os.homedir(), ROOTS[agent], 'skills','sealseek-media');
}
export async function hashes(dir) {
  const result={};
  async function walk(base='') {
    for (const item of await fs.readdir(path.join(dir,base),{ withFileTypes:true })) {
      if (item.name === MARKER) continue;
      const rel=path.join(base,item.name);
      requireValue(!item.isSymbolicLink(), 'UNMANAGED_TARGET', 'Nested symlinks are not managed Skill content.');
      if (item.isDirectory()) await walk(rel); else result[rel]=hash(await fs.readFile(path.join(dir,rel)));
    }
  }
  await walk();return result;
}
export async function status(agent = 'generic', custom) {
  const target=destination(agent,custom), stat=await exists(target), sourceHashes=await hashes(SOURCE);
  const adapter = Object.hasOwn(ROOTS, agent) ? agent : 'generic';
  sourceHashes['SKILL.md'] = hash(renderSkill(await fs.readFile(path.join(SOURCE,'SKILL.md'),'utf8'),agent));
  if (!stat) return { ok:true, agent, adapter, destination:target, installed:false, managed:false, current:false };
  if (stat.isSymbolicLink()) {
    const actual=await fs.realpath(target).catch(()=>null);
    return { ok:true, agent, adapter, destination:target, installed:true, managed:actual === await fs.realpath(SOURCE), current:actual === await fs.realpath(SOURCE), mode:'link' };
  }
  const manifest=await readJson(path.join(target,MARKER)).catch(()=>null);
  const managed=manifest?.owner===META.name;
  if(managed)requireValue(manifest.hashes&&typeof manifest.hashes==='object'&&!Array.isArray(manifest.hashes)&&Object.values(manifest.hashes).every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)),'UNMANAGED_STATE','Managed Skill hash manifest is invalid; preserve the target and inspect its installation record.');
  const actual=stat.isDirectory() ? await hashes(target) : {};
  const edited=managed && (Object.entries(manifest.hashes).some(([name,digest])=> actual[name]!==digest && name !== path.join('agents','openai.yaml')) || Object.keys(actual).some(name=>!(name in manifest.hashes)));
  return { ok:true,agent,adapter,destination:target,installed:true,managed,current:managed && !edited && manifest.version===META.version && manifest.source===SOURCE && Object.keys(actual).length===Object.keys(sourceHashes).length && Object.entries(sourceHashes).every(([name,digest])=> actual[name]===digest || name === path.join('agents','openai.yaml')), edited,mode:'copy',version:manifest?.version };
}
export async function install(agent = 'generic', options = {}) {
  const rename = options.rename || fs.rename;
  const info=await status(agent,options.path), target=info.destination;
  requireValue(!info.installed || info.managed, 'UNMANAGED_TARGET', 'Existing Skill is user-owned. Choose an unused --path.');
  requireValue(!info.edited || options.force, 'LOCAL_EDITS', 'Managed Skill has local edits. Review them before --force; update will create a backup.');
  if (info.current) return { ...info, state:'unchanged' };
  await fs.mkdir(path.dirname(target), { recursive:true });
  let backup;
  if (info.installed) {
    backup=path.join(stateRoot(),'skill-backups',`${agent}-${crypto.randomUUID()}`);
    requireValue(!await exists(backup), 'TARGET_EXISTS', 'Backup target exists.');
    await fs.mkdir(path.dirname(backup),{recursive:true,mode:0o700});
    await fs.cp(target,backup,{ recursive:true,errorOnExist:true,force:false,dereference:true });
    const originalHashes = await hashes(target), backupHashes = await hashes(backup);
    requireValue(JSON.stringify(originalHashes) === JSON.stringify(backupHashes), 'BACKUP_VERIFICATION_FAILED', 'Backup hashes differ; update stopped.');
  }
  const staging=`${target}.staging-${crypto.randomUUID()}`;
  await fs.cp(SOURCE,staging,{ recursive:true,errorOnExist:true,force:false });
  const skillText = await fs.readFile(path.join(staging,'SKILL.md'),'utf8');
  await fs.writeFile(path.join(staging,'SKILL.md'),renderSkill(skillText,agent));
  if (backup && await exists(path.join(target,'agents','openai.yaml'))) {
    const oldManifest=await readJson(path.join(target,MARKER));
    const name=path.join('agents','openai.yaml');
    if(hash(await fs.readFile(path.join(target,name)))!==oldManifest.hashes[name]) await fs.copyFile(path.join(target,name),path.join(staging,name));
  }
  const digest=await hashes(staging);
  await createJson(path.join(staging,MARKER),{ owner:META.name,version:META.version,source:SOURCE,hashes:digest });
  let retired;
  try {
    if (info.installed) { const candidate=`${target}.retired-${crypto.randomUUID()}`; await rename(target,candidate); retired=candidate; }
    await rename(staging,target);
  } catch (e) {
    if (retired && !await exists(target)) await fs.rename(retired,target);
    if (['EPERM','EBUSY','EACCES'].includes(e.code) && backup) {
      // Recoverable in-place sync is restricted to known managed files.
      for (const name of Object.keys(digest)) {
        const q=path.join(target,name); await fs.mkdir(path.dirname(q),{ recursive:true }); await fs.copyFile(path.join(staging,name),q);
      }
      for (const name of Object.keys(await hashes(target))) if (!(name in digest)) await fs.unlink(path.join(target,name));
      await fs.copyFile(path.join(staging,MARKER),path.join(target,MARKER));
    } else throw e;
  }
  const actual=await hashes(target);
  requireValue(Object.keys(actual).length===Object.keys(digest).length && Object.entries(digest).every(([name,h])=>actual[name]===h), 'INSTALL_VERIFICATION_FAILED', 'Installed Skill hashes differ; recover from the returned backup.', { backup });
  if (await exists(staging)) await fs.rm(staging,{recursive:true});
  if (retired && await exists(retired)) await fs.rm(retired,{recursive:true});
  return { ...await status(agent,options.path), state:'installed', ...(backup ? { backup } : {}) };
}
