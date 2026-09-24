import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import ImageGallery from "../../src/components/ImageGallery";
import ImageViewer, { adjacentImageId } from "../../src/components/ImageViewer";
import { workflowViewerImages } from "../../src/components/WorkflowImageLibrary";
import BulkActions from "../../src/components/BulkActions";
import { processBatch, batchFeedback, selectedItems, orderImageDeletions } from "../../src/bulkActions";
import { removeFromKnowledgeBase, listDeletedSessions } from "../../src/api";
import { reducer } from "../../src/useStore";

afterEach(() => vi.unstubAllGlobals());

it("keeps both thumbnail modes while image clicks offer enlargement", () => {
  const html = renderToStaticMarkup(<ImageGallery images={[{id:"i",name:"Scene",url:"/image",session_title:"Chat",session_id:"s"}]} />);
  expect(html).toContain("Comfortable");
  expect(html).toContain("Compact");
  expect(html).toContain('title="Enlarge Scene"');
  expect(html).not.toContain("Open Scene in Chat");
});

it("offers explicit source navigation and full-window arrows", () => {
  const html = renderToStaticMarkup(<ImageViewer images={[{id:"i",name:"Scene",url:"/image",session_id:"s"}]} selectedId="i" onOpenSource={() => {}} />);
  expect(html).toContain('aria-label="Image viewer"');
  expect(html).toContain('aria-label="Previous image" disabled');
  expect(html).toContain('aria-label="Next image" disabled');
  expect(html).toContain("Go to source chat");
  expect(html).toContain("1 of 1");
});

it("navigates across gallery pages and wraps both ends", () => {
  const images = Array.from({length:26}, (_,i) => ({id:String(i)}));
  expect(adjacentImageId(images,"11",1)).toBe("12");
  expect(adjacentImageId(images,"25",1)).toBe("0");
  expect(adjacentImageId(images,"0",-1)).toBe("25");
  expect(adjacentImageId([],"0",1)).toBeNull();
  expect(adjacentImageId(images,"missing",1)).toBeNull();
});

it("includes outputs and composites from all matching workflow runs with unique IDs", () => {
  const run = {workflow_id:"w",id:"a",workflow_name:"Scene",outputs:[{id:"o",stage_number:1,url:"/output"}],composites:[{layout:"grid",url:"/grid"}]};
  const images = workflowViewerImages([run,{...run,id:"b"}]);
  expect(images.map(image => image.id)).toEqual(["w:a:o","w:a:grid","w:b:o","w:b:grid"]);
  expect(images.map(image => image.name)).toEqual(["Stage 1","Stitched grid","Stage 1","Stitched grid"]);
});

it("processes once per item, sequentially, continuing after a partial failure", async () => {
  const calls = [];
  let pending = false;
  const items = [{id:"a",title:"A"},{id:"b",title:"B"},{id:"c",title:"C"}];
  const result = await processBatch([...items,items[0]], async item => {
    expect(pending).toBe(false); pending = true;
    await Promise.resolve(); calls.push(item.id); pending = false;
    if (item.id === "b") throw Error("Disk is read-only");
    return item.id;
  });
  expect(calls).toEqual(["a","b","c"]);
  expect(result.succeeded.map(item=>item.id)).toEqual(["a","c"]);
  expect(result.failed).toEqual([{item:items[1],error:"Disk is read-only"}]);
  expect(batchFeedback(result,"Deleted")).toContain("Deleted 2 items. 1 failed");
  expect(batchFeedback(result,"Deleted")).toContain("B: Disk is read-only");
});

it("selection remains bounded to live items without losing selections outside a search", () => {
  const items = [{id:"a"},{id:"b"}];
  expect(selectedItems(items,new Set(["a","b","deleted"]))).toEqual(items);
  const html = renderToStaticMarkup(<BulkActions label="images" items={[items[0]]}
    selection={{enabled:true,items,selectAll:()=>{},clear:()=>{},end:()=>{}}}
    actions={[{label:"Delete selected",onClick:()=>{}}]} />);
  expect(html).toContain("2 selected");
  expect(html).toContain("Select all (1)");
  expect(html).toContain("across pages");
});

it("removes indexed legacy image selections from the end of each message", async () => {
  const originals = ["zero", "one", "two", "three", "four"];
  const items = [1,3,4].map(index=>({id:String(index),session_id:"s",image_id:`raw-msg-${index}`}));
  const result = await processBatch(orderImageDeletions(items), image => originals.splice(Number(image.image_id.split("-").at(-1)),1));
  expect(result.succeeded).toHaveLength(3);
  expect(originals).toEqual(["zero","two"]);
  expect(items.map(item=>item.id)).toEqual(["1","3","4"]);
});

it("surfaces backend deletion and trash-load failures", async () => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,json:async()=>({detail:"Index is locked"})}));
  await expect(removeFromKnowledgeBase("doc")).rejects.toThrow("Index is locked");
  await expect(listDeletedSessions()).rejects.toThrow("Could not load Recently deleted");
});

it("bulk profile deletion preserves live chat/image settings and unrelated profiles", () => {
  const state = {customProfiles:[{id:"a"},{id:"b"},{id:"c"}],activeCustomProfileId:"b",temperature:.23,imageSettings:{prompt:"Keep this"}};
  const next = reducer(state,{type:"DELETE_CUSTOM_PROFILES",payload:["a","b"]});
  expect(next.customProfiles).toEqual([{id:"c"}]);
  expect(next.activeCustomProfileId).toBe("");
  expect(next.temperature).toBe(.23);
  expect(next.imageSettings).toEqual({prompt:"Keep this"});
});
