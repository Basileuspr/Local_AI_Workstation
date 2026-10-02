import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { useDispatch, useRefs, useStore } from "./useStore";
import * as api from "./api";
import { imageTasksObserver } from "./appPolling";
import { invalidatePolling } from "./polling";
import { createMessageId } from "./messageIds";
import { imageRequest, reconcileImageLora, validateImageSelection } from "./chatImageGeneration";
import { activeImageTasks, imageGenerationClientId, imageTaskFinished, restoreImageTaskHistory } from './imageTaskState';
import { emptyGenerationHistory, generationHistoryReducer } from "./generationHistory";
import { referenceOptions } from './generationReference';

const ImageGenerationContext = createContext(null);

export function ImageGenerationProvider({ children, onSessionSaved }) {
  const state = useStore();
  const dispatch = useDispatch();
  const refs = useRefs();
  const latest = useRef(state);
  latest.current = state;
  const sessionSaved = useRef(onSessionSaved);
  sessionSaved.current = onSessionSaved;
  const [catalog, setCatalog] = useState({ models: [], loras: [], runtime: null, loraError: "" });
  const [catalogError, setCatalogError] = useState("");
  const [requests, setRequests] = useState([]);
  const [clientId] = useState(imageGenerationClientId);
  const [connectionError, setConnectionError] = useState('');
  const [referenceImage, setReferenceImage] = useState(null);
  const [referenceStrength, setReferenceStrength] = useState(.3);
  const [referenceFit, setReferenceFit] = useState('contain');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false), referenceUploads = useRef(new WeakMap());
  useEffect(() => () => { if (referenceImage?.url) URL.revokeObjectURL(referenceImage.url); }, [referenceImage]);
  const activeRequests = useRef([]);
  const taskStatuses = useRef(new Map());
  // After clearing, only later submissions may repopulate this tab's output.
  const visibleRequests = useRef(null);
  const hydratedTasks = useRef(false);
  const submittedHere = useRef(false);
  const taskSerial = useRef(0);
  const newSession = useRef(null);
  const [history, updateHistory] = useReducer(generationHistoryReducer, emptyGenerationHistory);
  const { result, images: generatedImages, batch } = history;
  const historyRef = useRef(history);
  historyRef.current = history;
  const setResult = useCallback(image => updateHistory({ type: "preview", image }), []);
  const historyRefresh = useRef(0);
  const refreshHistory = useCallback(async () => {
    const checkedUrls = historyRef.current.images.map(image => image.url);
    if (!checkedUrls.length) return;
    const serial = ++historyRefresh.current;
    try {
      // Hidden images still exist. Locked or deleted sources are excluded by the API.
      const { images, hiddenImages } = await api.listSessionImageInventory();
      if (serial === historyRefresh.current) updateHistory({ type: "reconcile", checkedUrls,
        availableIds: [...images, ...hiddenImages].map(image => image.id) });
    } catch { /* A failed refresh must not erase this session's history. */ }
  }, []);
  useEffect(() => { void refreshHistory(); }, [refreshHistory, state.activeSidebarTab, state.sessions, state.sessionImages]);
  useEffect(() => {
    const refresh = () => { void refreshHistory(); };
    const storage = event => { if (event.key === "image-library-revision") refresh(); };
    window.addEventListener("image-library-changed", refresh);
    window.addEventListener("storage", storage);
    return () => {
      historyRefresh.current++;
      window.removeEventListener("image-library-changed", refresh);
      window.removeEventListener("storage", storage);
    };
  }, [refreshHistory]);
  const [pendingSessionSync, setPendingSessionSync] = useState(null);
  const refreshSerial = useRef(0);
  const refreshModels = useCallback(async () => {
    const serial = ++refreshSerial.current;
    try {
      const data = await api.loadImageGenerationModels();
      if (serial !== refreshSerial.current) return;
      setCatalog({ models: data.models || [], loras: data.loras || [], runtime: data.runtime || null, loraError: data.lora_error || "" });
      setCatalogError("");
    } catch (error) {
      if (serial === refreshSerial.current) setCatalogError(error.message);
    }
  }, []);
  const imageModelInventory = JSON.stringify(state.serviceStatus?.capabilities?.image_model_ids || []);
  const imageAvailable = state.serviceStatus?.capabilities?.features?.image_generation?.available;
  useEffect(() => { void refreshModels(); }, [refreshModels, state.connected, imageModelInventory, imageAvailable]);
  useEffect(() => {
    const settings = state.imageSettings;
    if (catalogError || reconcileImageLora(settings, catalog) === settings) return;
    dispatch({ type: "CLEAR_UNAVAILABLE_IMAGE_LORA", payload: settings });
    dispatch({ type: "SHOW_TOAST", payload: { message: "Saved LoRA unavailable for this model. Using the base model only; saved profiles are preserved.", type: "" } });
  }, [catalog, catalogError, state.imageSettings.modelId, state.imageSettings.loraId, dispatch]);
  useEffect(() => {
    if (!pendingSessionSync || state.isGenerating) return;
    if (state.currentSessionId !== pendingSessionSync.id) { setPendingSessionSync(null); return; }
    let disposed = false;
    void api.loadSession(pendingSessionSync.id).then((session) => {
      if (disposed || latest.current.isGenerating || latest.current.currentSessionId !== session.id) return;
      dispatch({ type: "SET_SESSION", payload: {
        id: session.id, revision: session.revision, messages: session.messages, title: session.title,
        memorySummary: session.memory_summary || "", summarizedMessageCount: session.summarized_message_count || 0,
      } });
      setPendingSessionSync(null);
    }).catch(() => { if (!disposed) setPendingSessionSync(null); });
    return () => { disposed = true; };
  }, [pendingSessionSync, state.isGenerating, state.currentSessionId, dispatch]);
  function toast(message, type = "error") { dispatch({ type: "SHOW_TOAST", payload: { message, type } }); }

  function stop(id) {
    const targets = typeof id === "string" ? [id] : activeRequests.current.map(request => request.id);
    for (const target of targets) {
      void api.stopImageGeneration(target).catch((error) => toast(error.message));
    }
  }
  const acceptTasks = useCallback(tasks => {
    const first = !hydratedTasks.current;
    hydratedTasks.current = true;
    const visible = task => visibleRequests.current === null || visibleRequests.current.has(task.request_id);
    if (first && !submittedHere.current && visibleRequests.current === null) updateHistory({type:'restore',history:restoreImageTaskHistory(tasks)});
    const newest = tasks.at(-1);
    // Also recover an accepted submission whose POST response was lost.
    if (!first && newest && visible(newest) && !taskStatuses.current.has(newest.request_id)) {
      updateHistory(newest.batch_id ? {type:'start-batch',id:newest.batch_id,
        requestIds:tasks.filter(task => task.batch_id === newest.batch_id).sort((a,b) => a.batch_index-b.batch_index).map(task => task.request_id)} : {type:'start-single'});
    }
    const pending = activeImageTasks(tasks);
    activeRequests.current = pending;
    setRequests(pending);
    refs.imageGenerationRequestId = pending[0]?.id || null;
    let completed = false;
    for (const task of tasks) {
      if (taskStatuses.current.get(task.request_id) === task.status) continue;
      taskStatuses.current.set(task.request_id, task.status);
      if (task.status === 'completed' && task.result) {
        if (visible(task) && (!first || submittedHere.current)) updateHistory({type:'complete',image:task.result});
        completed = true;
        if (latest.current.currentSessionId === task.session_id) setPendingSessionSync({id:task.session_id});
        if (visible(task) && !first && task.result.output_warning) dispatch({type:'SHOW_TOAST',payload:{message:task.result.output_warning,type:'error'}});
      } else if (imageTaskFinished(task)) {
        if (visible(task)) updateHistory({type:'batch-failed',batchId:task.batch_id,requestId:task.request_id,
          cancelled:task.status === 'cancelled',error:task.error});
        if (visible(task) && !first && task.status === 'failed') dispatch({type:'SHOW_TOAST',payload:{message:task.error || 'Image generation failed',type:'error'}});
      }
    }
    if (completed) void Promise.allSettled([sessionSaved.current?.()]);
    setConnectionError('');
  }, [dispatch, refs]);

  // This subscription belongs to the app, never to the visible Generate pane.
  // Unmount/refresh only detaches the UI; Stop is a separate server command.
  useEffect(() => {
    const stopAll = () => { for (const request of activeRequests.current) void api.stopImageGeneration(request.id).catch(() => {}); };
    refs.imageResetUi = stopAll;
    refs.imageAbortController = {abort:stopAll};
    const detach = imageTasksObserver(clientId).subscribe({ data: data => acceptTasks(data.tasks || []),
      recovered: () => setConnectionError(''),
      error: error => setConnectionError(`${error.message}. Reconnecting to submitted image requests.`) });
    return () => {
      detach(); taskSerial.current++; refreshSerial.current++;
      if (refs.imageResetUi === stopAll) { refs.imageResetUi = null; refs.imageAbortController = null; }
    };
  }, [refs, clientId, acceptTasks]);

  async function submit(items, {onSubmitted, batchId, reference = null, strength = .3, fit = 'contain'} = {}) {
    if (submitting.current) return false;
    try {
      if (catalogError) throw new Error(catalogError);
      if (!Array.isArray(items) || !items.length || items.length > 32) throw new Error('Choose 1–32 batch requests.');
      items = items.map(item => ({...item,settings:reconcileImageLora(item.settings,catalog)}));
      for (const item of items) {
        validateImageSelection(item.settings,catalog);
        if (reference && catalog.models.find(model => model.id === item.settings.modelId)?.supports_reference === false) {
          throw new Error('This model supports text-to-image only. Remove the reference image or choose an SDXL model.');
        }
        referenceOptions(reference, item.referenceStrength ?? strength, fit, item.settings.steps);
      }
    } catch (error) { toast(error.message); return false; }
    submittedHere.current = true;
    const source = latest.current.currentSessionId;
    const chatModel = latest.current.selectedModel;
    const captured = items.map((item,index) => ({...imageRequest({...item.settings},createMessageId()),
      request_label: [batchId ? `Image ${index+1} of ${items.length}` : '',item.label].filter(Boolean).join(' · ').slice(0,160) || null}));
    for (const request of captured) visibleRequests.current?.add(request.request_id);
    submitting.current = true; setIsSubmitting(true);
    try {
      if (reference) {
        let upload = referenceUploads.current.get(reference.file);
        if (!upload) {
          upload = api.uploadGenerationReference(reference.file);
          referenceUploads.current.set(reference.file, upload);
          upload.catch(() => referenceUploads.current.delete(reference.file));
        }
        const stored = await upload;
        captured.forEach((request, index) => Object.assign(request,
          referenceOptions(reference, items[index].referenceStrength ?? strength, fit, request.steps), {source_image_ref:stored.reference}));
      }
      let sessionId = source;
      if (!sessionId) {
        if (!newSession.current) newSession.current = api.createSession();
        sessionId = (await newSession.current).id;
      }
      const data = await api.imageGenerationTasks(clientId, {batch_id:batchId || null,chat_model:chatModel,
        requests:captured.map(request => ({...request,session_id:sessionId}))});
      // The entire batch has been accepted before the UI switches its output.
      taskSerial.current++;
      updateHistory(batchId ? {type:'start-batch',id:batchId,requestIds:captured.map(request => request.request_id)} : {type:'start-single'});
      acceptTasks(data.tasks || []);
      invalidatePolling("image-tasks", "queue", "runtime");
      const current = latest.current;
      if (current.currentSessionId === sessionId || (!source && !current.currentSessionId)) {
        if (!current.currentSessionId) dispatch({type:'SET_SESSION',payload:{id:sessionId,messages:[],title:'New Chat'}});
        setPendingSessionSync({id:sessionId});
      }
      onSubmitted?.(sessionId);
      void Promise.allSettled([sessionSaved.current?.()]);
      return true;
    } catch (error) {
      toast(error.message || 'Could not submit image requests');
      return false;
    } finally { newSession.current = null; submitting.current = false; setIsSubmitting(false); }
  }

  function generate(settings, {onSubmitted,requestLabel,...options} = {}) {
    return submit([{settings,label:requestLabel}],{onSubmitted,...options});
  }
  function generateBatch(items, options = {}) {
    return submit(items,{...options,batchId:createMessageId()});
  }

  const removeImages = images => updateHistory({type:'remove', urls:images.map(image => image.url)});
  function clear() {
    if (submitting.current) return false;
    visibleRequests.current = new Set();
    historyRefresh.current++;
    updateHistory({type:'clear'});
    setReferenceImage(null); setReferenceStrength(.3); setReferenceFit('contain');
    referenceUploads.current = new WeakMap();
    return true;
  }
  return <ImageGenerationContext.Provider value={{ ...catalog, catalogError, connectionError, refreshModels, requests, requestId: requests[0]?.id, isGenerating: requests.length > 0, result, setResult, generatedImages, batch, refreshHistory, generate, generateBatch, stop, removeImages,
    referenceImage, setReferenceImage, referenceStrength, setReferenceStrength, referenceFit, setReferenceFit, isSubmitting, clear }}>
    {children}
  </ImageGenerationContext.Provider>;
}

export function useImageGeneration() { return useContext(ImageGenerationContext); }
