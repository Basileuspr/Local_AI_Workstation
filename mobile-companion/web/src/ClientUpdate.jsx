import {useState} from 'react';
import {applyClientUpdate, clientVersion} from './clientVersion';

export default function ClientUpdate({version, blocked, hasDraft, apply = applyClientUpdate}) {
  const [confirm, setConfirm] = useState(false), [applying, setApplying] = useState(false), [error, setError] = useState('');
  if (!version || version === clientVersion) return null;
  async function update() {
    if (blocked || applying) return;
    if (hasDraft && !confirm) { setConfirm(true); return; }
    setApplying(true); setError('');
    try { await apply(version); }
    catch (failure) { setApplying(false); setError(failure.message); }
  }
  return <section className="panel client-update" aria-label="Phone app update">
    <strong>Update ready from your desktop</strong>
    <p>Reload to use the latest phone features. Accepted desktop jobs keep running.</p>
    {blocked ? <p>Finish or resolve the current submission before updating.</p> : hasDraft && <p>{confirm ? 'Updating clears the prompts and settings currently on this page. Keep editing if you want to save or send them first.' : 'Your current prompts and settings stay here until you choose to update.'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row"><button disabled={blocked || applying} onClick={update}>{applying ? 'Applying update…' : confirm && hasDraft ? 'Update and clear drafts' : 'Update phone app'}</button>{confirm && !applying && <button onClick={() => setConfirm(false)}>Keep editing</button>}</div>
  </section>;
}
