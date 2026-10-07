import { useState } from 'react';
import * as api from '../api';
import { TOOL_EFFECT_LABELS } from '../toolRegistry';
import './ChatTools.css';

export default function ChatToolReview({ plan, onResolved }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function decide(approved) {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.decideToolPlan(plan.id, approved); onResolved(plan.id); }
    catch (failure) {
      if (failure.status === 404) onResolved(plan.id);
      else { setError(failure.message); setBusy(false); }
    }
  }
  return <section className="chat-tool-review" role="region" aria-label="Review model tool action">
    <strong>Review action: {plan.name}</strong>
    <p>{plan.effects?.map(effect => TOOL_EFFECT_LABELS[effect] || effect).join(', ')} · Expires after 10 minutes</p>
    <pre style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap'}}>{JSON.stringify(plan.arguments, null, 2)}</pre>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => decide(false)}>Deny</button>
    <button type="button" disabled={busy} onClick={() => decide(true)}>{busy ? 'Processing…' : 'Approve action'}</button>
  </section>;
}
