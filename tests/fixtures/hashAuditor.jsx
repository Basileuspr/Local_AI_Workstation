import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import HashAuditor from '../../src/components/HashAuditor';
import '../../src/styles.css';

// Use an isolated backend and temporary source folders; this fixture makes
// real API calls. No scan starts until its Start audit button is pressed.
function Preview() {
  const [active, setActive] = useState(true);
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '8px 28px', fontSize: 12, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
      Test workspace · Temporary files only <button type="button" onClick={() => setActive(value => !value)} style={{ marginLeft: 20 }}>Switch workspace</button>
    </div>
    <main hidden={!active} style={{ flex: 1, minHeight: 0 }}><HashAuditor active={active} /></main>
    {!active && <p style={{ padding: 28 }}>Another workspace. The audit stays on the backend.</p>}
  </div>;
}
createRoot(document.getElementById('root')).render(<Preview />);
