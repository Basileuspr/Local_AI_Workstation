import { useEffect, useRef, useState } from "react";
import { useDispatch, useStore } from "../useStore";
import * as api from "../api";
import { PROMPT_ITERATION_SYSTEM, promptsMatch, readPromptProposal } from "../promptIteration";

export default function PromptIterationDialog({ onClose, preferences = {}, onPreferences }) {
  const state = useStore(), dispatch = useDispatch();
  const [original] = useState(() => ({ ...state.imageSettings }));
  const [model, setModel] = useState(preferences.model || state.selectedModel || "");
  const [goal, setGoal] = useState(preferences.goal || ""), [keep, setKeep] = useState(preferences.keep || "");
  const [proposal, setProposal] = useState(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState("");
  const dialog = useRef(null), task = useRef(null);
  useEffect(() => { onPreferences?.({ model, goal, keep }); }, [model, goal, keep, onPreferences]);
  useEffect(() => {
    dialog.current.showModal();
    return () => { task.current?.controller.abort(); if (task.current) void api.stopChat(task.current.id).catch(() => {}); };
  }, []);

  function stop() { if (task.current) { task.current.controller.abort(); void api.stopChat(task.current.id).catch(() => {}); } }
  function close() { stop(); onClose(); }
  async function analyze() {
    if (task.current) return;
    const pending = { id: crypto.randomUUID().replaceAll("-", ""), controller: new AbortController() };
    task.current = pending; setBusy(true); setError(""); setProposal(null); setPhase("Waiting in Prompt Queue…");
    try {
      const response = await api.streamChat({ model, requestId: pending.id, signal: pending.controller.signal,
        useKnowledgeBase: false, useMemory: false, systemPrompt: PROMPT_ITERATION_SYSTEM,
        options: { temperature: .4, num_predict: 3072 },
        messages: [{ role: "user", content: JSON.stringify({ task: "Analyze and iterate image prompts", prompt: original.prompt,
          negative_prompt: original.negativePrompt, goal: goal.trim() || "Improve visual clarity while preserving this image concept.",
          preserve_exactly: keep.trim() }) }] });
      const result = await readPromptProposal(response, setPhase);
      if (!pending.controller.signal.aborted) setProposal(result);
    } catch (failure) {
      if (failure.name !== "AbortError" && !pending.controller.signal.aborted) {
        setError(failure.message); pending.controller.abort(); void api.stopChat(pending.id).catch(() => {});
      }
    } finally { if (task.current === pending) { task.current = null; setBusy(false); setPhase(""); } }
  }
  const stale = !promptsMatch(state.imageSettings, original);
  return <dialog ref={dialog} className="iterate-dialog" aria-label="Analyze and iterate prompts" onCancel={event => { event.preventDefault(); close(); }}>
    <header><div><h2>Analyze &amp; Iterate</h2><p>Refine your prompts for the next image.</p></div><button type="button" onClick={close} aria-label="Close prompt iteration">Close ×</button></header>
    <div className="iterate-body">
      <details><summary>Current prompts</summary><p className="iterate-text">{original.prompt}</p><p className="iterate-text">Negative: {original.negativePrompt || "None"}</p></details>
      <label>Analysis model<select value={model} disabled={busy} onChange={event => setModel(event.target.value)}><option value="">Choose a local model</option>{state.models.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      {!state.models.length && <p role="status">No local chat models are available. Check the model connection and reopen this dialog.</p>}
      <label>What should change?<textarea rows={3} maxLength={2000} value={goal} disabled={busy} onChange={event => setGoal(event.target.value)} placeholder="For example: another training image of the same character, with a side view and different lighting." /></label>
      <label>Keep exactly (optional)<input maxLength={1000} value={keep} disabled={busy} onChange={event => setKeep(event.target.value)} placeholder="Character name, LoRA trigger words, key appearance details" /></label>
      <p className="iterate-help">Review the suggestions before applying them. Your model, LoRA, seed and generation settings stay as selected.</p>
      {error && <p role="alert" className="workflow-error">{error}</p>}{busy && <p role="status">{phase}</p>}
      <div className="iterate-actions"><button type="button" disabled={busy || !original.prompt.trim() || !state.models.some(item => item.name === model)} onClick={analyze}>{proposal ? "Analyze again" : "Analyze prompts"}</button>{busy && <button type="button" onClick={stop}>Stop analysis</button>}</div>
      {proposal && <section className="iterate-proposal"><h3>Suggested revision</h3><p className="iterate-text">{proposal.analysis}</p>
        <label>Proposed prompt<textarea rows={6} maxLength={12000} value={proposal.prompt} onChange={event => setProposal({ ...proposal, prompt: event.target.value })} /></label>
        <label>Proposed negative prompt<textarea rows={3} maxLength={12000} value={proposal.negativePrompt} onChange={event => setProposal({ ...proposal, negativePrompt: event.target.value })} /></label>
        {stale && <p role="alert">Your Generate prompts changed while this review was open. Close and reopen Analyze &amp; Iterate to use the latest prompts.</p>}
        <button type="button" disabled={busy || stale || !proposal.prompt.trim()} onClick={() => {
          if (!promptsMatch(state.imageSettings, original)) return;
          dispatch({ type: "SET_IMAGE_SETTINGS", payload: { prompt: proposal.prompt, negativePrompt: proposal.negativePrompt } });
          dispatch({ type: "SHOW_TOAST", payload: { message: "Revised prompts applied. Generate the next image when ready.", type: "success" } });
          onClose();
        }}>Apply prompts to Generate</button>
      </section>}
    </div>
  </dialog>;
}
