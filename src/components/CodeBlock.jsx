import { useEffect, useRef, useState } from 'react';
import { copyPromptPhrase } from '../promptPhrases';
import './CodeBlock.css';

export default function CodeBlock({ code, language = '' }) {
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const timer = useRef(null), version = useRef(0), active = useRef(true);
  useEffect(() => {
    version.current++; setStatus('');
    return () => clearTimeout(timer.current);
  }, [code]);
  useEffect(() => { active.current = true; return () => { active.current = false; clearTimeout(timer.current); }; }, []);
  async function copy() {
    const current = version.current;
    setBusy(true); setStatus('');
    try {
      await copyPromptPhrase(code);
      if (!active.current || current !== version.current) return;
      setStatus('Copied'); clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus(''), 2500);
    } catch {
      if (active.current && current === version.current) setStatus('Copy unavailable. Select the code and use your device’s Copy command.');
    } finally { if (active.current) setBusy(false); }
  }
  return <section className="code-blackboard" aria-label={language ? `${language} code block` : 'Code block'} tabIndex={0}>
    <div className="code-blackboard-toolbar">
      <span className="code-blackboard-language">{language || 'Code'}</span>
      <button type="button" aria-label="Copy code" disabled={busy} onClick={copy}>{busy ? 'Copying…' : status === 'Copied' ? 'Copied ✓' : 'Copy code'}</button>
    </div>
    <pre><code className={language ? `language-${language}` : undefined}>{code}</code></pre>
    <span className={status && status !== 'Copied' ? 'code-blackboard-error' : 'code-blackboard-status'} role="status">{status}</span>
  </section>;
}
