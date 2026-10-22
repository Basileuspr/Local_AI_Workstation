import { useEffect, useId, useRef, useState } from 'react';
import { effectiveOutputBudget, MAX_RESPONSE_TOKENS, responseLengthPresets, validResponseLength } from '../responseBudget';
import './ResponseLengthControl.css';

export default function ResponseLengthControl({ value, onChange, contextWindow, disabled = false, id }) {
  const generatedId = useId(), input = useRef(null), helpId = `${generatedId}-help`;
  const [draft, setDraft] = useState(String(value > 0 ? value : 2048));
  const [custom, setCustom] = useState(false);
  useEffect(() => { setDraft(String(value > 0 ? value : 2048)); setCustom(false); }, [value]);
  const invalid = value !== -1 && (!validResponseLength(draft) || Number(draft) < 1);
  const preset = responseLengthPresets.some(([tokens]) => tokens === value);
  const limit = effectiveOutputBudget(value, contextWindow);
  return <div className="response-length-control">
    <label>Response length<select id={id} aria-label="Response length" disabled={disabled} aria-describedby={helpId}
      value={value === -1 ? '-1' : custom || !preset ? 'custom' : String(value)}
      onChange={event => {
        if (event.target.value === 'custom') { setCustom(true); if (value === -1) onChange(2048); requestAnimationFrame(() => input.current?.focus()); }
        else { setCustom(false); onChange(Number(event.target.value)); }
      }}>
      {responseLengthPresets.map(([tokens, label]) => <option key={tokens} value={tokens}>{label} · {tokens.toLocaleString()} tokens</option>)}
      <option value="custom">Custom token limit</option><option value={-1}>Automatic · up to 2,048 tokens</option>
    </select></label>
    <label>Maximum output tokens<input ref={input} type="number" inputMode="numeric" min={1} max={MAX_RESPONSE_TOKENS} step={1}
      aria-label="Maximum output tokens" aria-describedby={helpId} aria-invalid={invalid || undefined} disabled={disabled || value === -1} value={draft}
      onChange={event => { const next = event.target.value; setDraft(next); if (validResponseLength(next) && Number(next) > 0) { setCustom(true); onChange(Number(next)); } }}
      onBlur={() => { if (invalid) setDraft(String(value > 0 ? value : 2048)); }} /></label>
    <p id={helpId}>Next request: up to {limit.toLocaleString()} output tokens{value > limit ? ` (requested ${value.toLocaleString()}; context limit applies)` : ''}. Tokens include thinking and answer text, not words. A model may stop early; a full prompt can lower this limit. Tool rounds each have this cap. Document, Canvas and OCR tasks use their own budgets.</p>
    {invalid && <p role="alert">Enter a whole number from 1 to {MAX_RESPONSE_TOKENS.toLocaleString()}. The applied limit is still {value.toLocaleString()}.</p>}
  </div>;
}
