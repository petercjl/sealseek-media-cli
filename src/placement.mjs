import fs from 'node:fs/promises';
import {requireValue} from './core.mjs';

export const DEFAULT_PLACEMENT={mode:'append',columns:5,gap:48,width:320};
export function validatePlacement(value={}){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_INPUT','Placement must be an object.');
  requireValue(Object.keys(value).every(k=>['mode','columns','gap','width','height','positions'].includes(k)),'INVALID_INPUT','Unknown placement field.');
  const p={...DEFAULT_PLACEMENT,...value};
  requireValue(['append','grid','explicit'].includes(p.mode),'INVALID_INPUT','Placement mode must be append, grid or explicit.');
  requireValue(Number.isInteger(p.columns)&&p.columns>=1&&p.columns<=100,'INVALID_INPUT','Columns must be 1-100.');
  requireValue(Number.isFinite(p.gap)&&p.gap>=0&&p.gap<=10000,'INVALID_INPUT','Gap must be 0-10000.');
  for(const k of ['width','height'])if(p[k]!==undefined)requireValue(Number.isFinite(p[k])&&p[k]>0&&p[k]<=100000,'INVALID_INPUT','Dimensions must be positive and at most 100000.');
  if(p.mode==='explicit'){
    requireValue(Array.isArray(p.positions)&&p.positions.length>0&&p.positions.length<=100,'INVALID_INPUT','Explicit placement requires ordered positions.');
    for(const v of p.positions){
      requireValue(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['x','y','width','height'].includes(k)),'INVALID_INPUT','Each position contains x, y and optional width/height.');
      for(const k of ['x','y'])requireValue(Number.isFinite(v[k])&&Math.abs(v[k])<=1e9,'INVALID_INPUT','Coordinates must be finite canvas units.');
      for(const k of ['width','height'])if(v[k]!==undefined)requireValue(Number.isFinite(v[k])&&v[k]>0&&v[k]<=100000,'INVALID_INPUT','Position dimensions must be positive and at most 100000.');
    }
  }else requireValue(p.positions===undefined,'INVALID_INPUT','Positions require explicit mode.');
  return p;
}
export async function archiveOptions(options){
  const archive=options.archive??'canvas';
  requireValue(['canvas','none'].includes(archive),'INVALID_INPUT','Archive must be canvas or none.');
  requireValue(archive!=='none'||!options.placement,'INVALID_INPUT','Placement requires canvas archival.');
  let value={};
  if(options.placement){try{value=JSON.parse(await fs.readFile(options.placement,'utf8'));}catch{requireValue(false,'INVALID_INPUT','Placement must be a readable JSON file.');}}
  return {archive,placement:validatePlacement(value)};
}
