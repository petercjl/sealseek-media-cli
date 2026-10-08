import fs from 'node:fs/promises';
import {requireValue} from './core.mjs';
export const MODEL_POLICY=JSON.parse(await fs.readFile(new URL('./model-policy.json',import.meta.url),'utf8'));
export function allowedModels(kind){return [MODEL_POLICY[kind].default,...MODEL_POLICY[kind].alternatives];}
export function assertModelAllowed(id,kind){
 const kinds=kind?[kind]:['image','video'];
 requireValue(kinds.some(k=>allowedModels(k).includes(id)),'MODEL_UNAVAILABLE','This model is outside the package model allowlist.',{model:id,allowed_models:kinds.flatMap(allowedModels),paid_action:false});
}
export function filterModels(models){return ['image','video'].flatMap(kind=>allowedModels(kind).map(id=>models.find(m=>m.id===id&&m.type===kind)).filter(Boolean));}
