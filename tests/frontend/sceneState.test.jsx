import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { scenePrompt, DENOISE_PRESETS } from "../../src/sceneState";
import { workflowUpdate, newStage } from "../../src/imageWorkflow";
import * as api from "../../src/imageWorkflowApi";
import SceneStudio from "../../src/components/SceneStudio";

afterEach(() => vi.unstubAllGlobals());
it("constructs the full visible scene without exposing internal profile or object IDs", () => {
  const state = {visual_style:"Photograph", character:{name:"Mira",profile_id:"private",clothing:"blue shirt"},
    environment:{location:"workbench"}, camera:{focal_length:"50 mm"}, lighting:{direction:"left"},
    body:{right_hand:"gripping screwdriver",wrist_rotation:"clockwise"},
    objects:[{id:"internal",name:"screw",progression:"70% inserted"}], current_action:"tip remains seated"};
  expect(scenePrompt(state)).toBe("Visual style: Photograph. Character name: Mira. Character clothing: blue shirt. Environment location: workbench. Camera focal length: 50 mm. Lighting direction: left. Body right hand: gripping screwdriver. Body wrist rotation: clockwise. Visible object: screw. screw progression: 70% inserted. Visible action: tip remains seated.");
  expect(DENOISE_PRESETS.map(p => p.value)).toEqual([.25,.4]);
  expect(newStage({stages:[],assets:[{id:"asset"}]},"txt2img").source).toBeNull();
});
it("keeps scene state in saves and uses revision-bound frame and patch actions", async () => {
  const workflow = {id:"w",revision:5,name:"Scene",mode:"scene",scene:{state:{current_action:"turn"}},stages:[],prompt_settings:{seed:42}};
  expect(workflowUpdate(workflow).scene).toEqual(workflow.scene);
  const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>({})}); vi.stubGlobal("fetch",fetch);
  const frame = {workflow_id:"w",job_id:"j",output_id:"o"};
  await api.sceneFrame(workflow,frame,"restore");
  await api.patchScene(workflow,{body:{wrist_rotation:"clockwise"}});
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({revision:5,frame,action:"restore"});
  expect(fetch.mock.calls[1][1].method).toBe("PATCH");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({revision:5,changes:{body:{wrist_rotation:"clockwise"}},remove_objects:[]});
});
it("offers iterative scenes separately without requiring a model to start editing", () => {
  const html = renderToStaticMarkup(<SceneStudio active={false} />);
  expect(html).toContain("New iterative scene");
  expect(html).toContain("Generate the first frame from text or attach a starting image");
});
