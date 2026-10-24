import {parseDocument} from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),manifest=JSON.parse(fs.readFileSync(path.join(root,'release-integrity.json')));
const cap=JSON.parse(fs.readFileSync(path.join(root,'skills',pkg.skillLifecycle.skill,'capabilities.json')));
const skill=fs.readFileSync(path.join(root,'skills',pkg.skillLifecycle.skill,'SKILL.md'),'utf8');
const header=skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);if(!header)throw Error('RELEASE_SKILL_FRONTMATTER_INVALID');const parsed=parseDocument(header[1]);if(parsed.errors.length)throw Error('RELEASE_SKILL_FRONTMATTER_INVALID');const frontmatter=parsed.toJSON();if(frontmatter.metadata?.package!==pkg.name||frontmatter.metadata?.version!==pkg.version)throw Error('RELEASE_SKILL_IDENTITY_DRIFT');
if(manifest.version!==pkg.version||manifest.package!==pkg.name||cap.package_version!==pkg.version||!skill.includes('  version: '+pkg.version+'\n'))throw Error('RELEASE_IDENTITY_DRIFT: package and Skill versions must agree after bump');
const actualFiles=[];
function list(at,prefix=''){for(const entry of fs.readdirSync(at,{withFileTypes:true})){const rel=prefix?prefix+'/'+entry.name:entry.name;if(entry.isSymbolicLink())throw Error('RELEASE_UNSAFE_LINK: '+rel);if(entry.isDirectory())list(path.join(at,entry.name),rel);else actualFiles.push(rel);}}
for(const name of ['package.json',...pkg.files]){if(name==='release-integrity.json')continue;const p=path.join(root,name);if(fs.statSync(p).isDirectory())list(p,name.replace(/\/$/,''));else actualFiles.push(name);}
if(JSON.stringify(actualFiles.sort())!==JSON.stringify(Object.keys(manifest.files).sort()))throw Error('RELEASE_RESOURCE_SET_DRIFT');
for(const [file,expected]of Object.entries(manifest.files)){const bytes=fs.readFileSync(path.join(root,file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('RELEASE_CONTENT_DRIFT: '+file);}
for(const file of ['INSTALL.md','UPDATE.md','lifecycle/engine.mjs'])if(!manifest.files[file])throw Error('RELEASE_RESOURCE_MISSING: '+file);
console.log(JSON.stringify({ok:true,version:pkg.version,files:Object.keys(manifest.files).length}));
