import {fitDimensions} from './imageDimensions';
// Pure draft helpers. Execution and model selection do not belong in this layer.
export function promptSettingsOnly(value = {}) {
  return {
    prompt: value.prompt ?? "",
    negative_prompt: value.negative_prompt ?? "",
    seed: value.seed ?? -1,
    steps: value.steps ?? 30,
    guidance: value.guidance ?? 7,
  };
}

export function availableWorkflowAssets(workflow) {
  return (workflow?.assets || []).filter(asset => !(workflow.removed_asset_ids || []).includes(asset.id));
}

export function removeWorkflowAssets(workflow, removed) {
  const ids = new Set(removed.map(item => item.id));
  return {...workflow, removed_asset_ids:[...new Set([...(workflow.removed_asset_ids || []), ...ids])],
    stages:workflow.stages.map(stage => {
      const references = (stage.reference_asset_ids || []).map((id,index) => ({id,role:stage.reference_roles?.[index]})).filter(item => !ids.has(item.id));
      return {...stage, source:stage.source?.kind === 'asset' && ids.has(stage.source.id) ? null : stage.source,
        mask_asset_id:ids.has(stage.mask_asset_id) ? null : stage.mask_asset_id,
        control_asset_id:ids.has(stage.control_asset_id) ? null : stage.control_asset_id,
        reference_asset_ids:references.map(item => item.id), reference_roles:references.map(item => item.role).filter(Boolean)};
    })};
}

export function workflowUpdate(workflow) {
  return {
    revision: workflow.revision,
    name: workflow.name,
    scene_notes: workflow.scene_notes,
    prompt_settings: promptSettingsOnly(workflow.prompt_settings),
    stages: workflow.stages,
    removed_asset_ids: workflow.removed_asset_ids || [],
    ...(workflow.mode ? { mode: workflow.mode, scene: workflow.scene || null } : {}),
  };
}

export function imageSourceOptions(workflow, stageIndex) {
  return [
    ...availableWorkflowAssets(workflow).map(asset => ({ value: `asset:${asset.id}`, label: asset.name })),
    ...workflow.stages.slice(0, stageIndex)
      .map((stage, index) => ({ ...stage, number: index + 1 }))
      .filter(stage => stage.operation !== "describe")
      .map(stage => ({ value: `stage:${stage.id}`, label: `Stage ${stage.number} output` })),
  ];
}

export function parseSource(value) {
  if (!value) return null;
  const [kind, id] = value.split(":");
  return { kind, id };
}

export function newStage(workflow, operation) {
  const earlier = [...workflow.stages].reverse().find(stage => stage.operation !== "describe");
  const assets = availableWorkflowAssets(workflow);
  return {
    id: crypto.randomUUID().replaceAll("-", ""),
    operation,
    source_mode: operation !== "txt2img" && earlier ? "previous" : "selected",
    lock_aspect_ratio: true,
    source: operation === "txt2img" ? null : earlier ? { kind: "stage", id: earlier.id }
      : assets.length ? { kind: "asset", id: assets[0].id } : null,
    mask_asset_id: null,
    control_asset_id: null,
    reference_asset_ids: [],
    provider_slot: "",
    model_id: "",
    width: 512,
    height: 512,
    strength: 0.55,
    control_scale: 1,
    control_kind: "edges",
    upscale_factor: 2,
  };
}

export const runIsActive = record => Boolean(record && ["queued", "running", "cancelling"].includes(record.status));

export function stageWithProvider(workflow, operation, catalog) {
  const stage = newStage(workflow, operation);
  const provider = catalog.providers.find(item => item.available && item.operations.includes(operation));
  const source=sourceDimensions(workflow,stage.source);
  return { ...stage, ...(source && operation!=="txt2img" ? fitDimensions(source.width,source.height) : {}), provider_slot: provider?.id || "", model_id: provider?.models[0]?.id || "" };
}


export function resolveStageSources(stages) {
  let previous=null;
  return stages.map(stage=>{
    const next=stage.source_mode==='previous'?{...stage,source:stage.operation==='txt2img'||!previous?null:{kind:'stage',id:previous.id}}:stage;
    if(next.operation!=='describe')previous=next;
    return next;
  });
}
export function sourceDimensions(workflow,source,seen=new Set()) {
  if(!source)return null;
  if(source.kind==='asset')return workflow.assets.find(asset=>asset.id===source.id)||null;
  if(seen.has(source.id))return null;seen.add(source.id);
  const stage=workflow.stages.find(stage=>stage.id===source.id);if(!stage||stage.operation==='describe')return null;
  if(stage.operation==='upscale'){const input=sourceDimensions(workflow,stage.source,seen);return input?{width:input.width*stage.upscale_factor,height:input.height*stage.upscale_factor}:null;}
  return {width:stage.width,height:stage.height};
}
