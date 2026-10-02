import { useRef, useState } from "react";
import { useStore, useDispatch } from "../useStore";
import { moveModel } from "../modelOrder";
import { formatModelLabel } from "../modelCatalog";
import { useDismissiblePopup } from '../useDismissiblePopup';

export default function ModelOrder() {
  const state = useStore(), dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const trigger = useRef(null), wrapper = useRef(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useDismissiblePopup({ open, container: wrapper, onDismiss: () => setOpen(false), returnFocus: trigger });
  return <span className="model-order-control" ref={wrapper}>
    <button ref={trigger} type="button" onClick={() => setOpen(!open)} aria-expanded={open}>Select / order models</button>
    {open && <div className="model-order-panel" role="dialog" aria-label="Select and order models">
      <strong>Models ({state.models.length})</strong>
      {state.models.length === 0 && <p role="status">{state.modelsError || "No models available. Check the Ollama connection and installed models."}</p>}
      {state.models.map((model, index) => <div className={`model-choice-row${state.selectedModel === model.name ? " selected" : ""}`} key={model.name}>
        <label className="model-choice">
          <input type="radio" name="chat-model-choice" aria-label={`Select ${model.name}`} value={model.name} checked={state.selectedModel === model.name}
            onChange={() => dispatch({ type: "SET_SELECTED_MODEL", payload: model.name })} />
          <span><strong>{model.name}</strong>{formatModelLabel(model) !== model.name && <small>{formatModelLabel(model)}</small>}
            {state.selectedModel === model.name && <small className="model-choice-active">Selected for chat</small>}</span>
        </label>
        <button type="button" aria-label={`Move ${model.name} up`} disabled={!index} onClick={() => dispatch({ type: "SET_MODEL_ORDER", payload: moveModel(state.models, model.name, -1) })}>↑</button>
        <button type="button" aria-label={`Move ${model.name} down`} disabled={index === state.models.length - 1} onClick={() => dispatch({ type: "SET_MODEL_ORDER", payload: moveModel(state.models, model.name, 1) })}>↓</button>
      </div>)}
      <button onClick={close}>Done</button>
    </div>}
  </span>;
}
