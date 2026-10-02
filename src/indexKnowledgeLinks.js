import { useCallback, useEffect, useRef, useState } from "react";
import { indexKnowledgeLinksRequest } from "./api";

const changedEvent = "index-knowledge-links-changed";
export function announceIndexKnowledgeChange() { window.dispatchEvent(new Event(changedEvent)); }

export function useIndexKnowledgeLinks(active, docId) {
  const [data, setData] = useState({ nodes: [], links: [] });
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const version = useRef(0), lock = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++version.current; setLoading(true); setError("");
    try {
      const result = await indexKnowledgeLinksRequest(docId ? { doc_id: docId } : {});
      if (current === version.current) { setData(result); setLoaded(true); }
    } catch (failure) { if (current === version.current) setError(failure.message); }
    finally { if (current === version.current) setLoading(false); }
  }, [docId]);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const update = () => { void refresh(); };
    window.addEventListener(changedEvent, update);
    return () => { version.current++; window.removeEventListener(changedEvent, update); };
  }, [active, refresh]);
  async function change(entryId, nodeId, remove = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await indexKnowledgeLinksRequest({}, remove ? "DELETE" : "POST", { entry_id: entryId, doc_id: nodeId });
      announceIndexKnowledgeChange();
      await refresh();
      setNotice(remove ? "Connection removed." : "Connected to Knowledge.");
    } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return { ...data, loaded, loading, busy, error, notice, refresh, change };
}
