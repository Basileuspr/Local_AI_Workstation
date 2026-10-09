import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider} from '../../src/useStore';
import AppLayout from '../../src/components/AppLayout';
import SidebarNavigation from '../../src/components/SidebarNavigation';
import ViewerBrowser from '../../src/components/ViewerBrowser';
import CodeViewer from '../../src/components/CodeViewer';
import BrowserWindow from '../../src/components/BrowserWindow';
import '../../src/styles.css';
function Fixture(){
  const [tab,setTab]=useState('browser'),[sources,setSources]=useState({});
  return <StoreProvider><AppLayout activeTab={tab} sidebar={()=><SidebarNavigation activeTab={tab} onSelect={setTab}/>}>
    <div className="pane" data-capture-tab="browser" hidden={tab!=='browser'}><ViewerBrowser active={tab==='browser'} onOpenSource={source=>{setSources(current=>({...current,[source.kind]:source}));setTab(`${source.kind}-viewer`);}}/></div>
    {['html','css','js'].map(kind=><div key={kind} className="pane" data-capture-tab={`${kind}-viewer`} hidden={tab!==`${kind}-viewer`}><CodeViewer kind={kind} incoming={sources[kind]}/></div>)}
  </AppLayout></StoreProvider>;
}
createRoot(document.getElementById('root')).render(window.workstationDesktop?.browserWindow?<BrowserWindow/>:<Fixture/>);
