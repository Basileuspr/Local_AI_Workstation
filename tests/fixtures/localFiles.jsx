import React from 'react';
import {createRoot} from 'react-dom/client';
import LocalFiles from '../../src/components/LocalFiles';
import '../../src/styles.css';
import '../../src/components/ChatWorkspace.css';
createRoot(document.getElementById('root')).render(<div id="app"><aside style={{width:220,flexShrink:0}}>Workspace navigation</aside><main id="main"><header style={{height:56,flexShrink:0}}>Local Files workspace</header><div className="workspace-panes"><section className="pane"><LocalFiles/></section></div></main></div>);
