import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const own=path.resolve(here,'../.runtime');const candidates=fs.existsSync(path.resolve(here,'../.agent-package.json'))?[own]:[own,path.resolve(here,'../../..')];
let local;
for(const root of candidates){try{const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(p.name==="@petercjl/sealseek-media-cli"&&fs.existsSync(path.join(root,p.skillLifecycle.entry))){local=path.join(root,p.skillLifecycle.entry);break;}}catch{}}
if(!local){console.error(JSON.stringify({ok:false,code:'ISOLATED_RUNTIME_MISSING',message:'Complete the package-managed Skill installation.'}));process.exit(1);}
const r=spawnSync(process.execPath,[local,...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});process.exit(r.status??1);
