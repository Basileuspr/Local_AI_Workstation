import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCanvas, subscribeCanvas, commitCanvas, selectCanvas, undoCanvas, redoCanvas, canvasContext } from "../canvasStore";
import { drawCanvas, hitCanvas } from "../canvasDrawing";
import { createMessageId } from "../messageIds";
import { useStore, useDispatch } from "../useStore";
import { attachWorkspaceContext } from "../workspaceContext";
import "./Tools.css";

export default function CanvasWorkspace() {
  const value=useSyncExternalStore(subscribeCanvas,getCanvas), canvas=useRef(null), gesture=useRef(null);
  const state=useStore(), dispatch=useDispatch();
  const [tool,setTool]=useState("select"),[color,setColor]=useState("#234878"),[text,setText]=useState("Text"),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const chosen=value.objects.filter(item=>value.selectedIds.includes(item.id));
  useEffect(()=>{drawCanvas(canvas.current.getContext("2d"),value.objects,value.selectedIds);},[value]);
  function guard(action) { try { action(); setError(""); } catch(failure) { setError(failure.message); } }
  function point(event) { const rect=canvas.current.getBoundingClientRect();return {x:Math.max(0,Math.min(1200,(event.clientX-rect.left)*1200/rect.width)),y:Math.max(0,Math.min(800,(event.clientY-rect.top)*800/rect.height))}; }
  function down(event) {
    if(event.button!==0)return;
    const start=point(event); canvas.current.setPointerCapture(event.pointerId);
    if(tool==="select") {
      const hit=[...value.objects].reverse().find(item=>hitCanvas(item,start.x,start.y));
      if(!hit){selectCanvas([]);return;}
      const ids=event.shiftKey ? value.selectedIds.includes(hit.id)?value.selectedIds.filter(id=>id!==hit.id):[...value.selectedIds,hit.id] : value.selectedIds.includes(hit.id)?value.selectedIds:[hit.id];
      selectCanvas(ids);gesture.current={start,objects:value.objects,ids};
    } else if(tool==="text") guard(()=>commitCanvas([...value.objects,{id:createMessageId(),type:"text",...start,width:Math.min(600,Math.max(60,text.length*13)),height:text.split("\n").length*28,text,color}]));
    else gesture.current={start,objects:value.objects,item:{id:createMessageId(),type:tool,...start,width:0,height:0,text:"",color,points:tool==="pen"?[[0,0]]:undefined}};
  }
  function move(event) {
    const g=gesture.current;if(!g)return;const p=point(event),dx=p.x-g.start.x,dy=p.y-g.start.y;
    if(g.item){g.item={...g.item,width:dx,height:dy};if(g.item.type==="pen") { const points=[...g.item.points,[dx,dy]].slice(-2000);g.item={...g.item,points}; }g.preview=[...g.objects,g.item];}
    else g.preview=g.objects.map(item=>g.ids.includes(item.id)?{...item,x:item.x+dx,y:item.y+dy}:item);
    drawCanvas(canvas.current.getContext("2d"),g.preview,[]);
  }
  function up() {
    const g=gesture.current;gesture.current=null;
    if(g?.item?.type==="pen" && g.preview) {
      const xs=g.item.points.map(p=>p[0]),ys=g.item.points.map(p=>p[1]);
      const left=Math.min(...xs),top=Math.min(...ys);
      const item={...g.item,x:g.start.x+left,y:g.start.y+top,width:Math.max(...xs)-left,height:Math.max(...ys)-top,points:g.item.points.map(([x,y])=>[x-left,y-top])};
      g.preview=[...g.objects,item];
    }
    if(g?.preview) guard(()=>commitCanvas(g.preview));
  }
  async function copy() {
    try {
      const image=document.createElement("canvas");image.width=1200;image.height=800;drawCanvas(image.getContext("2d"),value.objects);
      if(window.workstationDesktop?.copyImage){const result=await window.workstationDesktop.copyImage(image.toDataURL("image/png"));if(result?.error)throw new Error(result.error);}
      else {const blob=await new Promise(resolve=>image.toBlob(resolve,"image/png"));await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);}
      setNotice("Canvas artwork copied.");setError("");
    }catch(failure){setError(failure.message);}
  }
  return <section className="tools-workspace">
    <header className="tools-heading"><h1>Canvas</h1><p>Draw here or ask chat to create and edit a diagram on the canvas.</p></header>
    <div className="tools-toolbar">{["select","text","rect","ellipse","line","arrow","pen"].map(item=><button key={item} aria-pressed={tool===item} onClick={()=>setTool(item)}>{({rect:"Rectangle",pen:"Draw"})[item]||item[0].toUpperCase()+item.slice(1)}</button>)}
      <label>Color <input type="color" value={color} onChange={e=>setColor(e.target.value)} /></label><input aria-label="Canvas text" value={text} onChange={e=>setText(e.target.value)} maxLength={3000} />
      <button onClick={()=>guard(undoCanvas)}>Undo</button><button onClick={()=>guard(redoCanvas)}>Redo</button><button onClick={copy}>Copy Canvas</button>
    </div>
    <div className="tools-toolbar"><button disabled={!chosen.length} onClick={()=>guard(()=>commitCanvas(value.objects.filter(item=>!value.selectedIds.includes(item.id))))}>Delete selected</button><button onClick={()=>selectCanvas(value.objects.map(item=>item.id))}>Select all</button><button onClick={()=>selectCanvas([])}>Deselect</button><button onClick={async()=>{try{const context=canvasContext();await attachWorkspaceContext(state,dispatch,`[Canvas context: ${context.selected_ids.length?"selected objects":"whole canvas"}]\n${JSON.stringify(context)}\nAsk a question or request an edit on the canvas.`);}catch(failure){setError(failure.message);}}}>Use in chat</button></div>
    {chosen.length===1 && <div className="tools-toolbar"><label>Selected text <input aria-label="Selected canvas text" value={chosen[0].text} onChange={e=>guard(()=>commitCanvas(value.objects.map(item=>item.id===chosen[0].id?{...item,text:e.target.value}:item)))} /></label><button onClick={()=>guard(()=>commitCanvas(value.objects.map(item=>value.selectedIds.includes(item.id)?{...item,color}:item)))}>Apply color</button></div>}
    {chosen.length===1 && chosen[0].type!=="pen" && <div className="tools-toolbar">{["x","y","width","height"].map(key=><label key={key}>{key} <input type="number" style={{width:85}} min="-2400" max="2400" value={chosen[0][key]} onChange={e=>guard(()=>commitCanvas(value.objects.map(item=>item.id===chosen[0].id?{...item,[key]:Number(e.target.value)}:item)))} /></label>)}</div>}
    {error&&<p role="alert">{error}</p>}<p role="status">{notice}</p>
    <div className="canvas-scroll"><canvas ref={canvas} width="1200" height="800" aria-label="Whiteboard canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;drawCanvas(canvas.current.getContext("2d"),value.objects,value.selectedIds);}} /></div>
    <p className="tools-note">Saved on this device. Shift-click selects multiple objects; drag to move. Chat uses selected objects, or the whole canvas when none are selected. Copy Canvas includes only the 1200 × 800 artwork.</p>
  </section>;
}
