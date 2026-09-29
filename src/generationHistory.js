export const emptyGenerationHistory = { images: [], result: null, batch: null };

export function generationHistoryReducer(state, action) {
  if (action.type === 'restore') return action.history;
  if (action.type === 'remove') {
    const removed = new Set(action.urls);
    const images = state.images.filter(image => !removed.has(image.url));
    return {...state, images, result: removed.has(state.result?.url) ? images.at(-1) || null : state.result,
      batch: state.batch && {...state.batch, slots: state.batch.slots.map(slot => removed.has(slot.image?.url)
        ? {...slot, image:null, status:'removed'} : slot)}};
  }
  if (action.type === "start-batch") return { ...state, batch: { id: action.id,
    slots: action.requestIds.map(id => ({ id, status: "pending", image: null })) } };
  if (action.type === "start-single") return { ...state, batch: null };
  if (action.type === "batch-failed") {
    if (state.batch?.id !== action.batchId) return state;
    return { ...state, batch: { ...state.batch, slots: state.batch.slots.map(slot => slot.id === action.requestId
      ? { ...slot, status: action.cancelled ? "stopped" : "failed", error: action.error } : slot) } };
  }
  if (action.type === "complete") {
    // Keep lightweight output records, not the base64 image returned by the API.
    const { data_url, ...image } = action.image;
    const batch = state.batch && state.batch.id === image.batch_id ? { ...state.batch,
      slots: state.batch.slots.map(slot => slot.id === image.request_id ? { ...slot, status: "complete", image } : slot) } : state.batch;
    return { ...state, batch, images: [...state.images.filter(item => item.url !== image.url), image],
      result: !image.batch_id || state.batch?.id === image.batch_id ? image : state.result };
  }
  if (action.type === "preview") return { ...state, result: action.image, batch: null };
  if (action.type === "reconcile") {
    const checked = new Set(action.checkedUrls);
    const available = new Set(action.availableIds);
    const images = state.images.filter(image => !checked.has(image.url)
      || available.has(`${image.session_id}:${image.message_id}:${image.image_id}`));
    if (images.length === state.images.length) return state;
    const retained = new Set(images.map(image => image.url));
    const batch = state.batch && { ...state.batch, slots: state.batch.slots.map(slot => slot.image && !retained.has(slot.image.url)
      ? { ...slot, image: null, status: "deleted" } : slot) };
    return { ...state, images, batch, result: state.result && !images.some(image => image.url === state.result.url)
      ? images.at(-1) || null : state.result };
  }
  return state;
}

export function generationViewerImages(images, apiUrl) {
  return images.map(image => ({ ...image, id: image.url, url: apiUrl(image.url), name: image.filename || "Generated image" }));
}
