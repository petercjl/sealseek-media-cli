import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),skill=path.join(root,'skills',p.skillLifecycle.skill);
const {commandContracts,maintenanceContract}=await import('./engine.mjs');
const declarationFile=path.join(root,'capabilities.json'),declaration=JSON.parse(fs.readFileSync(declarationFile));
const existing=declaration.commandContracts||{};for(const key of Object.keys(existing))if(key.startsWith('skill ')||key.startsWith('update '))delete existing[key];
declaration.maintenanceContract=maintenanceContract;declaration.commandContracts={...existing,...commandContracts()};fs.writeFileSync(declarationFile,JSON.stringify(declaration,null,2)+'\n');
const file=path.join(skill,'SKILL.md');const text=fs.readFileSync(file,'utf8');
fs.writeFileSync(file,text.replace(/(  version: )[^\n]+/,'$1'+p.version));
const cap=path.join(skill,'capabilities.json'),v=JSON.parse(fs.readFileSync(cap));v.package_version=p.version;v.maintenanceContract=maintenanceContract;v.commandContracts=declaration.commandContracts;fs.writeFileSync(cap,JSON.stringify(v,null,2)+'\n');
function inventory(dir){const out={};function walk(at=''){for(const e of fs.readdirSync(path.join(dir,at),{withFileTypes:true})){const rel=at?at+'/'+e.name:e.name;if(e.isDirectory())walk(rel);else if(e.isFile())out[rel]=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,rel))).digest('hex');else throw Error('Links are not distributable');}}walk();return out;}
if(p.name.endsWith('/cloud-hug-style-transfer'))fs.writeFileSync(path.join(root,'npm/integrity.json'),JSON.stringify(inventory(skill),null,2)+'\n');
if(p.name.endsWith('/nano-product-replacement'))fs.writeFileSync(path.join(root,'skill-integrity.json'),JSON.stringify(inventory(skill),null,2)+'\n');
const files={};for(const entry of ['package.json',...p.files]){if(entry==='release-integrity.json')continue;const target=path.join(root,entry);if(!fs.existsSync(target))throw Error('Missing packed resource '+entry);if(fs.statSync(target).isDirectory()){for(const [name,hash] of Object.entries(inventory(target)))files[entry.replace(/\/$/,'')+'/'+name]=hash;}else files[entry]=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');}
fs.writeFileSync(path.join(root,'release-integrity.json'),JSON.stringify({package:p.name,version:p.version,files},null,2)+'\n');
console.log(JSON.stringify({ok:true,version:p.version,files:Object.keys(files).length}));
