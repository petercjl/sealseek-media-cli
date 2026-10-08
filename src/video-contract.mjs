import {MODEL_POLICY} from './model-policy.mjs';
import { modelContract } from './models.mjs';
import { requireValue } from './core.mjs';
export function videoGuide(model,options) {
  const c=modelContract(model||MODEL_POLICY.video.default,options);requireValue(c.type==='video','INVALID_INPUT','Expected a video model.');
  return {...c,reference_modes:{reference:{flag:'--reference',meaning:'Appearance/content reference; does not guarantee the exact first frame.',supported:c.capabilities.reference_images.model_support,max:c.capabilities.reference_images.max},first:{flag:'--first',meaning:'Explicit first-frame constraint.',supported:c.capabilities.first_frame.model_support},last:{flag:'--last',meaning:'Explicit last-frame constraint, requires --first.',supported:c.capabilities.last_frame.model_support}},image_only_flags:['--count','--size'],inspection_command:'sealseek-media task inspect TASK_ID --json',recovery_command:'sealseek-media task diagnose TASK_ID --json'};
}
