import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createWorkspaceTextFind, workspaceFindScope } from '../workspaceFind';
import { appTabLabels } from '../navigation';
import { dismissPopupLayers } from '../popupDismissal';
import './WorkspaceFind.css';

const nativeTabs = new Set(['browser', 'media-manager', 'integrations']);
export default function WorkspaceFind({ activeTab, pinnedTab, onOpen }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [matchCase, setMatchCase] = useState(false);
  const [scope, setScope] = useState(null), [results, setResults] = useState({ matches: 0, current: 0 }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef(null), engine = useRef(null), previousFocus = useRef(null), version = useRef(0), previousSearch = useRef(null);
  const initialDirection = useRef(null);
  const latest = useRef(null), desktop = globalThis.window?.workstationDesktop;
  latest.current = { activeTab, pinnedTab, onOpen, open, query, matchCase, scope };
  function close(restore = true) {
    version.current++; engine.current?.clear(); previousSearch.current = null; initialDirection.current = null;
    if (latest.current.scope?.native) void desktop?.stopWorkspaceFind?.(latest.current.scope.native, restore).catch(() => {});
    setOpen(false); setBusy(false); setError('');
    const node = previousFocus.current;
    if (restore && node?.isConnected && node.getClientRects().length && !node.closest('[inert]')) node.focus({ preventScroll: true });
  }
  function show(target = document.activeElement, native = null) {
    const state = latest.current;
    previousFocus.current = state.open ? previousFocus.current : target;
    const tab = native || target?.closest?.('[data-capture-tab]')?.dataset.captureTab || state.activeTab;
    const root = workspaceFindScope(document, tab);
    const nextNative = root?.tagName === 'DIALOG' ? null : nativeTabs.has(tab) ? tab : null;
    dismissPopupLayers(document, 'find', node => !!node.closest('.workspace-navigation'));
    for (const popup of document.querySelectorAll('[popover]')) if (popup.matches(':popover-open')) popup.hidePopover();
    if (state.scope?.root !== root || state.scope?.native !== nextNative) {
      version.current++; engine.current?.clear(); previousSearch.current = null;
      if (state.scope?.native) void desktop?.stopWorkspaceFind?.(state.scope.native).catch(() => {});
      setScope({ tab, root, native: nextNative });
    }
    state.onOpen?.(); setOpen(true);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
  }
  async function search(direction = null) {
    const state = latest.current; if (!state.open || !state.scope) return;
    const ticket = ++version.current, key = `${state.scope.tab}:${state.matchCase}:${state.query}`;
    setError('');
    if (!state.query.trim()) { engine.current?.clear(); previousSearch.current = null; setResults({ matches: 0, current: 0 }); setBusy(false); if (state.scope.native) void desktop?.stopWorkspaceFind?.(state.scope.native).catch(() => {}); return; }
    setBusy(true);
    try {
      const root = workspaceFindScope(document, state.scope.tab);
      if (root !== state.scope.root) {
        engine.current?.clear(); previousSearch.current = null;
        if (state.scope.native) void desktop?.stopWorkspaceFind?.(state.scope.native).catch(() => {});
        if (!root) { close(false); return; }
        setScope({ ...state.scope, root, native: root.tagName === 'DIALOG' ? null : state.scope.native }); return;
      }
      if (state.scope.native && desktop?.findWorkspaceText) {
        const value = await desktop.findWorkspaceText({ target: state.scope.native, query: state.query, matchCase: state.matchCase, forward: direction !== -1, findNext: direction !== null && previousSearch.current === key });
        if (ticket !== version.current || !latest.current.open) return;
        if (value.error) throw Error(value.error);
        if (value.cancelled) { previousSearch.current = null; setResults({ matches: 0, current: 0 }); setBusy(false); setError('Page changed. Search again.'); return; }
        if (!value.unavailable) { setResults({ matches: value.matches, current: value.current }); previousSearch.current = key; setBusy(false); return; }
      }
      const value = direction !== null && previousSearch.current === key ? engine.current.move(direction) : engine.current.search(root ? [root] : [], state.query, state.matchCase);
      if (ticket === version.current) { setResults(value); previousSearch.current = key; setBusy(false); }
    } catch (failure) { if (ticket === version.current) { setError(failure.message || 'Search could not finish.'); setBusy(false); } }
  }
  useEffect(() => { engine.current = createWorkspaceTextFind(document); return () => { version.current++; engine.current.clear(); if (latest.current.scope?.native) void desktop?.stopWorkspaceFind?.(latest.current.scope.native).catch(() => {}); }; }, []);
  useEffect(() => {
    const keys = event => {
      if (event.defaultPrevented) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && event.key.toLowerCase() === 'f') {
        if (event.target.closest?.('.document-editor') && !event.target.closest('.workspace-find')) return;
        event.preventDefault(); event.stopPropagation(); show(event.target); return;
      }
      if (!latest.current.open) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'F3' || (mod && !event.altKey && event.key.toLowerCase() === 'g')) { event.preventDefault(); event.stopPropagation(); void search(event.shiftKey ? -1 : 1); }
    };
    window.addEventListener('keydown', keys, true);
    const unsubscribe = desktop?.onWorkspaceFind?.(value => {
      if (value.close) { close(); return; }
      if (value.refresh) { if (latest.current.open && latest.current.scope?.native === value.target) { previousSearch.current = null; void search(); } }
      else if (value.direction && latest.current.open && latest.current.scope?.native === value.target) { input.current?.focus(); void search(value.direction); }
      else { initialDirection.current = value.direction || null; show(null, value.target); }
    });
    return () => { window.removeEventListener('keydown', keys, true); unsubscribe?.(); };
  }, [desktop]);
  useEffect(() => { close(false); }, [activeTab, pinnedTab]);
  useEffect(() => {
    if (!open) return;
    version.current++; setResults({ matches: 0, current: 0 }); setBusy(Boolean(query.trim()));
    const timer = setTimeout(() => { const direction = initialDirection.current; initialDirection.current = null; void search(direction); }, 120);
    return () => { clearTimeout(timer); version.current++; };
  }, [open, query, matchCase, scope]);
  useEffect(() => {
    if (!open || !scope?.root) return;
    let timer;
    const schedule = () => { previousSearch.current = null; if (!timer) timer = setTimeout(() => { timer = null; void search(); }, 100); };
    const observer = new MutationObserver(records => {
      if (records.every(record => (record.target.nodeType === 3 ? record.target.parentElement : record.target).closest?.('.workspace-find'))) return;
      if (!scope.root.isConnected || scope.root.hidden || (scope.root.tagName === 'DIALOG' && !scope.root.open)) { close(false); return; }
      schedule();
    });
    observer.observe(scope.root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'style', 'class', 'value', 'inert'] });
    const edits = event => { if (!event.target.closest?.('.workspace-find')) schedule(); };
    scope.root.addEventListener('input', edits);
    const removal = new MutationObserver(() => { if (!scope.root.isConnected) close(false); });
    if (scope.root.tagName === 'DIALOG') removal.observe(document.body, {childList: true, subtree: true});
    return () => { observer.disconnect(); removal.disconnect(); scope.root.removeEventListener('input', edits); clearTimeout(timer); };
  }, [open, scope]);
  const modal = scope?.root?.tagName === 'DIALOG', destination = modal ? scope.root : globalThis.document?.getElementById('workspace-find-slot');
  const bar = <form className={`workspace-find${modal ? ' workspace-find-modal' : ''}`} role="search" aria-label="Find in current workspace" onSubmit={event => { event.preventDefault(); void search(1); }}>
    <label><span>{modal ? 'Find in dialog' : `Find in ${appTabLabels[scope?.tab] || 'workspace'}`}</span><input ref={input} type="search" aria-label="Find text" value={query} maxLength={200} placeholder="Find text…" autoComplete="off" spellCheck="false" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); void search(-1); } }}/></label>
    <output role="status" aria-live="polite">{error || (busy ? 'Searching…' : !query.trim() ? '' : results.matches ? `${results.current} of ${results.matches}${results.limited ? '+' : ''}` : results.limited ? 'Search limit reached' : 'No matches')}</output>
    <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!results.matches || busy} onClick={() => { void search(-1); }}>↑</button>
    <button type="button" aria-label="Next match" title="Next match (Enter)" disabled={!results.matches || busy} onClick={() => { void search(1); }}>↓</button>
    <button type="button" aria-label="Match case" aria-pressed={matchCase} onClick={() => setMatchCase(value => !value)}>Aa</button>
    <button type="button" aria-label="Close find" title="Close (Escape)" onClick={() => close()}>×</button>
  </form>;
  return <><button type="button" className="workspace-find-toggle" aria-label="Find in current tab" title="Find in current tab (Ctrl+F)" aria-expanded={open} onClick={() => show()}>Find</button>{open && destination && createPortal(bar, destination)}</>;
}
