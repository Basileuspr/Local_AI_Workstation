import { useEffect, useRef, useState } from "react";
import { batchFeedback, processBatch, selectedItems } from "./bulkActions";

const byId = item => item.id;

export function useSelection(items, key = byId, scope = "") {
  const [enabled, setEnabled] = useState(false);
  const [ids, setIds] = useState(new Set());
  const signature = JSON.stringify(items.map(key));
  useEffect(() => {
    const valid = new Set(JSON.parse(signature));
    setIds(current => new Set([...current].filter(id => valid.has(id))));
  }, [signature]);
  useEffect(() => { setIds(new Set()); setEnabled(false); }, [scope]);
  return {
    enabled, ids, items: selectedItems(items, ids, key),
    start: () => setEnabled(true),
    end: () => { setEnabled(false); setIds(new Set()); },
    clear: () => setIds(new Set()),
    toggle: item => setIds(current => {
      const next = new Set(current), id = key(item);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
    has: item => ids.has(key(item)),
    selectAll: visible => setIds(current => new Set([...current, ...visible.map(key)])),
    forget: removed => setIds(current => {
      const deleted = new Set(removed.map(key));
      return new Set([...current].filter(id => !deleted.has(id)));
    }),
  };
}

export function useBatchAction() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [hasError, setHasError] = useState(false);
  const lock = useRef(false);
  async function run({items, action, key, confirm, selection, after, verb}) {
    if (lock.current || !items.length) return null;
    if (confirm && !window.confirm(confirm)) return null;
    lock.current = true; setBusy(true); setFeedback(""); setHasError(false);
    try {
      const result = await processBatch(items, action, key);
      selection?.forget(result.succeeded);
      setFeedback(batchFeedback(result, verb));
      setHasError(!!result.failed.length);
      try { await after?.(result); }
      catch (error) { setFeedback(`${batchFeedback(result, verb)} Refresh failed: ${error.message}`); setHasError(true); }
      return result;
    } finally { lock.current = false; setBusy(false); }
  }
  return {busy, feedback, hasError, run};
}
