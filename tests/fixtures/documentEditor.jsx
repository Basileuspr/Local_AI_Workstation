import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentEditor from '../../src/components/DocumentEditor';
import '../../src/styles.css';

function Fixture() {
  const [active, setActive] = useState(true);
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <nav style={{ height: 30, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', background: '#101c2b', color: '#bdcde0', fontSize: 11 }}>
      <span>Isolated editor verification · temporary data</span><button onClick={() => setActive(!active)}>{active ? 'Show companion tab' : 'Return to editor'}</button>
    </nav><div hidden={!active} style={{ flex: 1, minHeight: 0 }}><DocumentEditor active={active}/></div>
    {!active && <p>Companion workspace. The document stays mounted.</p>}
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
