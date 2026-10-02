import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "../../src/useStore";
import { pickPreferences, savePreferences } from "../../src/preferences";
import AppearanceSettings from "../../src/components/AppearanceSettings";
import preview from "./generatePreview.svg";
import "../../src/styles.css";

function Fixture() {
  const state = useStore();
  useEffect(() => savePreferences(pickPreferences(state)), [state.appearance]);
  return <main style={{height:"100dvh",overflow:"auto",padding:24,background:"var(--bg-primary)"}}>
    <div style={{maxWidth:850,margin:"auto"}}><AppearanceSettings />
      <div style={{display:"flex",gap:20,flexWrap:"wrap",padding:20,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10}}>
        <div style={{flex:"1 1 200px"}}><h2>Interface sample</h2><p style={{color:"var(--text-dim)",marginTop:12}}>Text, labels, and borders follow UI contrast.</p>
          <input aria-label="Draft" placeholder="Keep a draft here" style={{padding:10,color:"var(--text)",background:"var(--bg-input)",border:"1px solid var(--border-active)",marginTop:12,width:"100%"}} />
        </div>
        <img src={preview} alt="Media preview retains its original colors" width={160} height={160} style={{objectFit:"contain"}} />
        <article aria-label="Document page" style={{color:"#202020",background:"#ffffff",padding:20,flex:"1 1 200px"}}><h2>Document page</h2><p style={{marginTop:12}}>The page keeps its original colors.</p></article>
      </div>
    </div>
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><StoreProvider><Fixture /></StoreProvider></React.StrictMode>);
