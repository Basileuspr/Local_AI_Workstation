export function sceneDraftFromAnalysis(workflow, analysis, modelId = "") {
  const asset = workflow.assets[0];
  if (!asset || !analysis?.state) throw new Error("The source image or scene analysis is missing. Analyze the image again.");
  const scale = Math.min(1, 1024 / Math.max(asset.width, asset.height));
  const dimension = value => Math.max(256, Math.round(value * scale / 8) * 8);
  return { ...workflow, mode: "scene", name: `Scene - ${asset.name}`.slice(0, 120),
    scene_notes: ["Image analysis — review observations before generating.", analysis.observations,
      ...(analysis.uncertainties || []).map(value => `Uncertain: ${value}`),
      ...(analysis.suggestions || []).map(value => `Possible next step (not applied): ${value}`)].join("\n\n").slice(0, 8000),
    scene: { state: analysis.state, source_asset_id: asset.id, parent_frame: null, identity_asset_ids: [], model_id: modelId,
      width: dimension(asset.width), height: dimension(asset.height), denoise: .25 },
    stages: [],
  };
}
