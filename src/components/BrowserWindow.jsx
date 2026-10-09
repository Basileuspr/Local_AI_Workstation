import {useState} from 'react';
import ViewerBrowser from './ViewerBrowser';
import WorkspaceInfo from './WorkspaceInfo';
import CodeViewer from './CodeViewer';
import {NavigationOpenContext} from './AppLayout';
import {useWorkspaceModalOpen} from '../useWorkspaceModalOpen';
import './BrowserWindow.css';

export default function BrowserWindow() {
  const [source,setSource]=useState(null),[showSource,setShowSource]=useState(false);
  const modalOpen=useWorkspaceModalOpen();
  return <main className="browser-window">
    <header className="browser-window-heading workspace-navigation">
      <strong>Browser</strong>
      <span>Independent window</span>
      {source && <button onClick={()=>setShowSource(value=>!value)}>{showSource?'Return to Browser':'Open source viewer'}</button>}
      <WorkspaceInfo tab="browser"/>
    </header>
    <NavigationOpenContext.Provider value={modalOpen}>
      <div className="browser-window-pane" hidden={showSource}><ViewerBrowser active={!showSource} onOpenSource={value=>{setSource(value);setShowSource(true);}}/></div>
      {source && <div className="browser-window-pane" hidden={!showSource}><CodeViewer kind={source.kind} incoming={source}/></div>}
    </NavigationOpenContext.Provider>
  </main>;
}
