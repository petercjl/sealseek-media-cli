import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ROOT, META, exists, requireValue, hash, createJson, readJson, stateRoot } from './core.mjs';

export const SOURCE = path.join(ROOT, 'skills', 'sealseek-media');
const MARKER = '.sealseek-media-install.json';
export function renderSkill(text, agent) { return agent === 'workbuddy' ? text.replace(/^---\n/, '---\ndisable-model-invocation: true\n') : text; }
export function destination(agent, custom) {
  const roots = { codex:'.codex', workbuddy:'.workbuddy', sealseek:'.sealseek' };
  requireValue(agent in roots, 'UNKNOWN_TARGET', 'Supported agents: codex, workbuddy, sealseek.');
  return custom ? path.resolve(custom) : path.join(os.homedir(), roots[agent], 'skills','sealseek-media');
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
export async function status(agent, custom) {
  const target=destination(agent,custom), stat=await exists(target), sourceHashes=await hashes(SOURCE);
  sourceHashes['SKILL.md'] = hash(renderSkill(await fs.readFile(path.join(SOURCE,'SKILL.md'),'utf8'),agent));
  if (!stat) return { ok:true, agent, destination:target, installed:false, managed:false, current:false };
  if (stat.isSymbolicLink()) {
    const actual=await fs.realpath(target).catch(()=>null);
    return { ok:true, agent, destination:target, installed:true, managed:actual === await fs.realpath(SOURCE), current:actual === await fs.realpath(SOURCE), mode:'link' };
  }
  const manifest=await readJson(path.join(target,MARKER)).catch(()=>null);
  const managed=manifest?.owner===META.name;
  const actual=stat.isDirectory() ? await hashes(target) : {};
  const edited=managed && (Object.entries(manifest.hashes).some(([name,digest])=> actual[name]!==digest && name !== path.join('agents','openai.yaml')) || Object.keys(actual).some(name=>!(name in manifest.hashes)));
  return { ok:true,agent,destination:target,installed:true,managed,current:managed && !edited && Object.keys(actual).length===Object.keys(sourceHashes).length && Object.entries(sourceHashes).every(([name,digest])=> actual[name]===digest || name === path.join('agents','openai.yaml')), edited,mode:'copy',version:manifest?.version };
}
export async function install(agent, options = {}) {
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
  if (backup && await exists(path.join(target,'agents','openai.yaml'))) await fs.copyFile(path.join(target,'agents','openai.yaml'),path.join(staging,'agents','openai.yaml'));
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
