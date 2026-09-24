import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useDispatch, useRefs, useStore } from "./useStore";
import * as api from "./api";
import { createMessageId } from "./messageIds";
import { generateImageForSession, reconcileImageLora, validateImageSelection } from "./chatImageGeneration";

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
  const running = useRef(new Map());
  const newSession = useRef(null);
  const [result, setResult] = useState(null);
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
  useEffect(() => { void refreshModels(); }, [refreshModels, state.activeSidebarTab]);
  useEffect(() => {
    const settings = state.imageSettings;
    if (catalogError || reconcileImageLora(settings, catalog) === settings) return;
    dispatch({ type: "CLEAR_UNAVAILABLE_IMAGE_LORA", payload: settings });
    dispatch({ type: "SHOW_TOAST", payload: { message: "Saved LoRA unavailable for this model. Using the base model only; saved profiles are preserved.", type: "" } });
  }, [catalog, catalogError, state.imageSettings.modelId, state.imageSettings.loraId, dispatch]);
  useEffect(() => {
    if (!pendingSessionSync || state.isGenerating) return;
    if (state.currentSessionId !== pendingSessionSync) { setPendingSessionSync(null); return; }
    let disposed = false;
    void api.loadSession(pendingSessionSync).then((session) => {
      if (disposed || latest.current.isGenerating || latest.current.currentSessionId !== session.id) return;
      dispatch({ type: "SET_SESSION", payload: {
        id: session.id, messages: session.messages, title: session.title,
        memorySummary: session.memory_summary || "", summarizedMessageCount: session.summarized_message_count || 0,
      } });
      setPendingSessionSync(null);
    }).catch(() => { if (!disposed) setPendingSessionSync(null); });
    return () => { disposed = true; };
  }, [pendingSessionSync, state.isGenerating, state.currentSessionId, dispatch]);
  function toast(message, type = "error") { dispatch({ type: "SHOW_TOAST", payload: { message, type } }); }

  function stop(id) {
    const targets = typeof id === "string" ? [id] : [...running.current.keys()];
    for (const target of targets) {
      void api.stopImageGeneration(target).catch((error) => toast(error.message));
      running.current.get(target)?.abort();
    }
  }
  useEffect(() => {
    refs.imageResetUi = () => { for (const controller of running.current.values()) controller.abort(); };
    return () => { refs.imageResetUi?.(); refs.imageResetUi = null; refreshSerial.current++; };
  }, [refs]);

  async function generate(settings, { onSubmitted, requestLabel } = {}) {
    try {
      if (catalogError) throw new Error(catalogError);
      settings = reconcileImageLora(settings, catalog);
      validateImageSelection(settings, catalog);
    } catch (error) { toast(error.message); return false; }
    const id = createMessageId();
    const controller = new AbortController();
    const source = latest.current.currentSessionId;
    const chatModel = latest.current.selectedModel;
    const captured = { ...settings };
    running.current.set(id, controller);
    setRequests(current => [...current, { id, prompt: captured.prompt, label: requestLabel }]);
    refs.imageGenerationRequestId = running.current.keys().next().value;
    refs.imageAbortController = { abort: () => { for (const item of running.current.values()) item.abort(); } };
    const showSession = (session) => {
      const current = latest.current;
      if (current.currentSessionId !== session.id && !(source === null && current.currentSessionId === null)) return;
      // An active text stream owns its live placeholder. Its final append will
      // also retrieve these image messages without replacing the stream DOM.
      if (current.isGenerating) { setPendingSessionSync(session.id); return; }
      dispatch({ type: "SET_SESSION", payload: {
        id: session.id, messages: session.messages, title: session.title,
        memorySummary: session.memory_summary || "", summarizedMessageCount: session.summarized_message_count || 0,
      } });
    };
    try {
      // Rapid submissions from a blank chat share its creation, not its draft.
      let sessionId = source;
      if (!sessionId) {
        if (!newSession.current) newSession.current = api.createSession();
        sessionId = (await newSession.current).id;
      }
      const generated = await generateImageForSession({
        api, settings: captured, requestLabel, requestId: id, signal: controller.signal, sessionId, chatModel,
        onSubmitted: (session) => { showSession(session); newSession.current = null; onSubmitted?.(session.id); }, onCompleted: showSession,
      });
      setResult(generated);
      toast("Image saved to the submitting chat", "success");
      return true;
    } catch (error) {
      if (error.name !== "AbortError" && !controller.signal.aborted) toast(error.message || "Image generation failed");
      return false;
    } finally {
      running.current.delete(id);
      setRequests(current => current.filter(request => request.id !== id));
      refs.imageGenerationRequestId = running.current.keys().next().value || null;
      if (!running.current.size) { refs.imageAbortController = null; newSession.current = null; }
      await Promise.allSettled([sessionSaved.current?.(), refreshModels()]);
    }
  }

  async function generateBatch(items) {
    try {
      if(!Array.isArray(items)||!items.length||items.length>32)throw new Error('Choose 1–32 batch requests.');
      if(catalogError)throw new Error(catalogError);
      for(const item of items)validateImageSelection(reconcileImageLora(item.settings,catalog),catalog);
    } catch(error){toast(error.message);return false;}
    // Every request captures its settings and original chat before any await.
    // The existing server queue serializes model work and supports individual Stop.
    const pending=items.map(item=>generate({...item.settings},{requestLabel:item.label}));
    void Promise.allSettled(pending);return true;
  }

  return <ImageGenerationContext.Provider value={{ ...catalog, catalogError, refreshModels, requests, requestId: requests[0]?.id, isGenerating: requests.length > 0, result, setResult, generate, generateBatch, stop }}>
    {children}
  </ImageGenerationContext.Provider>;
}

export function useImageGeneration() { return useContext(ImageGenerationContext); }
