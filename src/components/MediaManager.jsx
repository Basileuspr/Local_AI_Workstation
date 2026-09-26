import { useContext, useEffect, useRef, useState } from "react";
import { NavigationOpenContext } from "./AppLayout";
import "./MediaManager.css";
import { useDesktopCapabilities } from "./Compatibility";

export default function MediaManager({ active }) {
  const drawerOpen = useContext(NavigationOpenContext);
  const container = useRef(null);
  const [status, setStatus] = useState({ ready: false });
  const [attempt, setAttempt] = useState(0);
  const [focusNotice, setFocusNotice] = useState("");
  const desktop = window.workstationDesktop;
  const mediaCapability = useDesktopCapabilities()?.features?.media_manager;

  useEffect(() => {
    if (!active || !desktop?.startMediaManager) return;
    if (mediaCapability?.available === false) {
      setStatus({ ready: false, error: mediaCapability.detail });
      return;
    }
    let cancelled = false;
    setStatus({ ready: false });
    desktop.startMediaManager().then(result => { if (!cancelled) setStatus(result); })
      .catch(() => { if (!cancelled) setStatus({ error: "Could not open Media Manager. Try again." }); });
    const timer = window.setInterval(() => {
      desktop.mediaManagerStatus().then(result => { if (!cancelled && result.error) setStatus(result); }).catch(() => {});
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active, attempt, desktop, mediaCapability?.available, mediaCapability?.detail]);

  useEffect(() => {
    if (!desktop?.placeMediaManager) return;
    const position = () => {
      const bounds = container.current?.getBoundingClientRect();
      desktop.placeMediaManager({ visible: active && status.ready && !drawerOpen,
        bounds: bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }).catch(() => {});
    };
    position();
    const resize = new ResizeObserver(position);
    if (container.current) resize.observe(container.current);
    window.addEventListener("resize", position);
    return () => { resize.disconnect(); window.removeEventListener("resize", position); desktop.placeMediaManager({ visible: false }).catch(() => {}); };
  }, [active, status.ready, drawerOpen, desktop]);

  return <section className="media-manager-shell" aria-label="Media Manager">
    <header className="media-manager-access">
      <span>Media Manager · Local workspace</span>
      {status.ready && <button type="button" onClick={async () => {
        try { const result = await desktop.focusMediaManager(); setFocusNotice(result?.focused ? "Media Manager focused" : result?.error || "Could not focus Media Manager."); }
        catch { setFocusNotice("Could not enter Media Manager. Reopen its tab."); }
      }}>Enter Media Manager</button>}
      {focusNotice && <small role="status">{focusNotice}</small>}
      <small>F6 returns to app navigation</small>
    </header>
    <div className="media-manager-surface" ref={container}>
      {!desktop?.startMediaManager ? <p>Open the desktop app to use Media Manager.</p>
        : status.error ? <div role="alert"><p>{status.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Reopen Media Manager</button></div>
        : !status.ready ? <p role="status">Opening Media Manager…</p> : null}
    </div>
  </section>;
}
