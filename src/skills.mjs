import * as lifecycle from '../lifecycle/engine.mjs';
export const SOURCE=lifecycle.source;
export const INSTALLATION={fallback_agent:'generic',custom_path_required:true,...lifecycle.installationLifecycle};
export const renderSkill=text=>text;
export const hashes=dir=>Promise.resolve(lifecycle.inventory(dir,{skip:['.agent-package.json','.runtime','.sealseek-media-install.json']}));
export const destination=(agent='generic',custom)=>lifecycle.resolveTarget({agent,path:custom}).target;
export async function status(agent='generic',custom){return lifecycle.status(lifecycle.resolveTarget({agent,path:custom}));}
export async function install(agent='generic',options={}){return lifecycle.install(lifecycle.resolveTarget({agent,path:options.path}),options);}
