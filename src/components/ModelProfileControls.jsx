import { useStore, useDispatch } from '../useStore';
import { modelDefaults, thinkingLabel } from '../modelProfiles';

export default function ModelProfileControls() {
  const state = useStore(), dispatch = useDispatch();
  const model = state.models.find(item => item.name === state.selectedModel);
  if (!model) return null;
  const defaults = modelDefaults(model);
  const context = state.contextWindow || defaults.contextWindow;
  const windows = [...new Set([context, defaults.maxContext, ...[2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144].filter(n => n <= defaults.maxContext)])].sort((a, b) => a - b);
  const set = (key, value) => dispatch({ type: 'SET_PARAM', key, value });
  return <div className="model-profile-controls">
    <label>Session context<select aria-label="Session context" value={context} onChange={event => set('contextWindow', Number(event.target.value))}>
      {windows.map(n => <option value={n} key={n}>{n.toLocaleString()} tokens</option>)}
    </select></label>
    <label>Thinking<select aria-label="Thinking mode" disabled={!defaults.thinkingChoices.length} value={JSON.stringify(state.thinking ?? defaults.thinking)}
      onChange={event => set('thinking', JSON.parse(event.target.value))}>
      {(defaults.thinkingChoices.length ? defaults.thinkingChoices : [null]).map(value => <option key={JSON.stringify(value)} value={JSON.stringify(value)}>{thinkingLabel(value)}</option>)}
    </select></label>
    <p>Context, thinking, response length and sampling are remembered for this installed model in this chat pane. Larger windows use more memory and may slow replies.</p>
    <button type="button" onClick={() => dispatch({ type: 'RESET_MODEL_PROFILE' })}>Reset this model’s settings</button>
  </div>;
}
