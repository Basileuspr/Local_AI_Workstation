import { useEffect, useRef, useState } from "react";
import { batchFeedback, processBatch, selectedItems } from "./bulkActions";
import {useRangeSelection} from './useRangeSelection';
import {hasSelectionModifier} from './fileSelection';

const byId = item => item.id;

export function useSelection(items, key = byId, scope = "", rangeItems = items) {
  const [enabled, setEnabled] = useState(false);
  const [ids, setIds] = useState(new Set());
  const signature = JSON.stringify(items.map(key));
  const range = useRangeSelection(rangeItems.map(key), ids, setIds, {scope});
  useEffect(() => {
    const valid = new Set(JSON.parse(signature));
    setIds(current => new Set([...current].filter(id => valid.has(id))));
  }, [signature]);
  useEffect(() => { setIds(new Set()); setEnabled(false); }, [scope]);
  return {
    enabled, ids, items: selectedItems(items, ids, key),
    start: () => setEnabled(true),
    end: () => { range.reset(); setEnabled(false); setIds(new Set()); },
    clear: () => { range.reset(); setIds(new Set()); },
    toggle: (item, event) => range.toggle(key(item), event),
    activate: (item, event, open) => {
      if (enabled || hasSelectionModifier(event) || !open) { setEnabled(true); range.toggle(key(item), event); }
      else open();
    },
    has: item => ids.has(key(item)),
    selectAll: visible => { range.reset(); setIds(current => new Set([...current, ...visible.map(key)])); },
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
