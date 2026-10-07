import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import InfoCenter from '../../src/components/InfoCenter';
import { appTabLabels } from '../../src/navigation';
import '../../src/styles.css';

function Preview() {
  const [tab, setTab] = useState('info-center');
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>Info Center preview · {tab === 'info-center' ? 'Choose a feature to test its navigation target.' : `Selected workspace: ${appTabLabels[tab]}`}
      {tab !== 'info-center' && <button onClick={() => setTab('info-center')}>Back to Info Center</button>}
    </div>
    <div className="workspace-panes" style={{ display: 'flex', flex: 1, minHeight: 0 }}><div className="pane" hidden={tab !== 'info-center'}><InfoCenter onOpenWorkspace={setTab} /></div></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<Preview />);
