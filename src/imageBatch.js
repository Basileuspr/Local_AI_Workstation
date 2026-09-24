import {MAX_IMAGE_STEPS,MAX_IMAGE_GUIDANCE} from './imageGenerationLimits';
import {seedMax} from './imageSettingsControls';
export const BATCH_FIELDS=[
  {key:'seed',label:'Seed',min:0,max:seedMax,integer:true,step:1},
  {key:'steps',label:'Steps',min:1,max:MAX_IMAGE_STEPS,integer:true,step:1},
  {key:'guidanceScale',label:'Guidance',min:1,max:MAX_IMAGE_GUIDANCE,step:.1},
  {key:'loraScale',label:'LoRA strength',min:0,max:2,step:.05},
];
export function buildImageBatch(settings,count,increments={seed:1}) {
  count=Number(count);if(!Number.isInteger(count)||count<1||count>32)throw new Error('Choose 1–32 images per batch.');
  const rows=[];
  for(let i=0;i<count;i++){
    const row={...settings};
    for(const field of BATCH_FIELDS){
      if(increments[field.key]===undefined)continue;
      if(field.key==='loraScale'&&!settings.loraId)throw new Error('Select a LoRA before varying its strength.');
      const base=field.key==='seed'&&settings.seed===''?1:Number(settings[field.key]??1),step=Number(increments[field.key]);
      if(!Number.isFinite(step)||(field.integer&&!Number.isInteger(step)))throw new Error(`${field.label} increment must be ${field.integer?'a whole':'a finite'} number.`);
      const value=Number((base+i*step).toFixed(6));
      if(!Number.isFinite(value)||value<field.min||value>field.max||(field.integer&&!Number.isInteger(value)))throw new Error(`Image ${i+1}: ${field.label} must stay between ${field.min} and ${field.max}. Reduce the batch count or increment.`);
      row[field.key]=value;
    }
    rows.push(row);
  }
  return rows;
}
export function batchLabel(row,index,count){return `Batch ${index+1}/${count} · Seed ${row.seed===''?'random':row.seed} · ${row.steps} steps · Guidance ${row.guidanceScale}${row.loraId?` · LoRA ${row.loraScale}`:''} · ${row.width} × ${row.height}`;}
