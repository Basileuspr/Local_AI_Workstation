import { describe, expect, it } from "vitest";
import { emptyGenerationHistory, generationHistoryReducer as reduce, generationViewerImages } from "../../src/generationHistory";
import { adjacentImageId } from "../../src/components/ImageViewer";

const image = n => ({ url: `/outputs/${n}.png`, filename: `${n}.png`, session_id: "chat", message_id: `message-${n}`, image_id: `image-${n}`, seed: n, data_url: "large payload" });
const available = n => `chat:message-${n}:image-${n}`;
const complete = (state, n) => reduce(state, { type: "complete", image: image(n) });

describe("Generate session history", () => {
  it("clears all previews and batch slots without changing the previous results", () => {
    const batch = reduce(emptyGenerationHistory, {type:'start-batch',id:'batch',requestIds:['a','b']});
    const state = reduce(batch, {type:'complete',image:{...image(1),request_id:'a',batch_id:'batch'}});
    expect(reduce(state, {type:'clear'})).toEqual(emptyGenerationHistory);
    expect(state.images).toHaveLength(1);
    expect(state.batch.slots[0].image.seed).toBe(1);
  });
  it("removes multiple results without renumbering batch slots or mutating originals", () => {
    let state = reduce(emptyGenerationHistory, {type:'start-batch',id:'batch',requestIds:['a','b','c']});
    for (const [index,id] of ['a','b','c'].entries()) state=reduce(state,{type:'complete',image:{...image(index+1),request_id:id,batch_id:'batch'}});
    const next=reduce(state,{type:'remove',urls:[image(1).url,image(3).url]});
    expect(next.images.map(item=>item.seed)).toEqual([2]);
    expect(next.result.seed).toBe(2);
    expect(next.batch.slots.map(slot=>[slot.id,slot.status])).toEqual([['a','removed'],['b','complete'],['c','removed']]);
    expect(state.images).toHaveLength(3);
    expect(state.batch.slots[0].image.seed).toBe(1);
  });

  it("reserves batch slots and fills the matching positions even when completion is out of order", () => {
    let state = reduce(emptyGenerationHistory, { type: "start-batch", id: "batch", requestIds: ["a", "b", "c", "d"] });
    expect(state.batch.slots).toHaveLength(4);
    state = reduce(state, { type: "complete", image: { ...image(2), request_id: "b", batch_id: "batch" } });
    state = reduce(state, { type: "complete", image: { ...image(1), request_id: "a", batch_id: "batch" } });
    expect(state.batch.slots.map(slot => slot.image?.seed)).toEqual([1, 2, undefined, undefined]);
    state = reduce(state, { type: "batch-failed", batchId: "batch", requestId: "c", error: "Out of memory" });
    state = reduce(state, { type: "batch-failed", batchId: "batch", requestId: "d", cancelled: true });
    expect(state.batch.slots.map(slot => slot.status)).toEqual(["complete", "complete", "failed", "stopped"]);
    state = reduce(state, { type: "reconcile", checkedUrls: state.images.map(item => item.url), availableIds: [available(2)] });
    expect(state.batch.slots[0].status).toBe("deleted");
    expect(state.batch.slots[0].image).toBeNull();
    expect(state.batch.slots[1].image.seed).toBe(2);
  });
  it("keeps late results from an older batch in history without replacing a newer output", () => {
    let state = reduce(emptyGenerationHistory, { type: "start-batch", id: "new", requestIds: ["new-1"] });
    state = reduce(state, { type: "complete", image: { ...image(1), request_id: "old-1", batch_id: "old" } });
    expect(state.batch.slots[0].image).toBeNull();
    expect(state.images).toHaveLength(1);
    state = reduce(state, { type: "start-single" });
    state = complete(state, 2);
    state = reduce(state, { type: "complete", image: { ...image(3), request_id: "new-1", batch_id: "new" } });
    expect(state.batch).toBeNull();
    expect(state.result.seed).toBe(2);
    expect(state.images).toHaveLength(3);
  });
  it("keeps every completed result in order and browses both ways with wrapping", () => {
    const state = [1, 2, 3].reduce(complete, emptyGenerationHistory);
    const images = generationViewerImages(state.images, url => `http://local${url}`);
    expect(images.map(item => item.seed)).toEqual([1, 2, 3]);
    expect(images[0]).not.toHaveProperty("data_url");
    expect(images[0].url).toBe("http://local/outputs/1.png");
    expect(adjacentImageId(images, images[2].id, -1)).toBe(images[1].id);
    expect(adjacentImageId(images, images[2].id, 1)).toBe(images[0].id);
    expect(adjacentImageId(images, images[0].id, -1)).toBe(images[2].id);
  });
  it("removes deleted sources, updates the preview, and handles deleting everything", () => {
    let state = [1, 2, 3].reduce(complete, emptyGenerationHistory);
    state = reduce(state, { type: "reconcile", checkedUrls: state.images.map(item => item.url), availableIds: [available(2)] });
    expect(state.images.map(item => item.seed)).toEqual([2]);
    expect(state.result.seed).toBe(2);
    state = reduce(state, { type: "reconcile", checkedUrls: state.images.map(item => item.url), availableIds: [] });
    expect(state).toEqual(emptyGenerationHistory);
  });
  it("does not erase images completed after a deletion refresh started", () => {
    const first = complete(emptyGenerationHistory, 1);
    const current = complete(first, 2);
    const reconciled = reduce(current, { type: "reconcile", checkedUrls: first.images.map(item => item.url), availableIds: [] });
    expect(reconciled.images.map(item => item.seed)).toEqual([2]);
    expect(reconciled.result.seed).toBe(2);
  });
  it("resetting the draft preview keeps session images available for browsing", () => {
    const state = reduce(complete(emptyGenerationHistory, 0), { type: "preview", image: null });
    expect(state.result).toBeNull();
    expect(state.images[0].seed).toBe(0);
    expect(emptyGenerationHistory.images).toEqual([]);
  });
});
