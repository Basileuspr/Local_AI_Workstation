import React from 'react';
import { createRoot } from 'react-dom/client';
import StorageLibraries from '../../src/components/StorageLibraries';
import '../../src/styles.css';
import '../../src/components/Dashboard.css';

// Real authenticated API calls. Set LAW_DATA_DIR to a temporary directory and
// choose only synthetic parent directories while validating this fixture.
createRoot(document.getElementById('root')).render(<main className="dashboard" style={{height:'100vh',overflow:'auto'}}>
  <h1>Storage libraries</h1><p className="dashboard-note">Test workspace · Temporary folders only</p>
  <StorageLibraries />
</main>);
