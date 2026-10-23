import {useEffect,useState} from 'react';

// Native views sit above the renderer. Hide them for the same dialogs and
// menus in both the workspace layout and independent Browser windows.
export function useWorkspaceModalOpen() {
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const update=()=>setOpen([...document.querySelectorAll('dialog[open], .disclosure-panel:not([hidden]), [popover]:popover-open')].some(node=>node.getClientRects().length>0));
    const observer=new MutationObserver(update);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden']});
    document.addEventListener('toggle', update, true);
    update();return ()=>{observer.disconnect();document.removeEventListener('toggle',update,true);};
  },[]);
  return open;
}
