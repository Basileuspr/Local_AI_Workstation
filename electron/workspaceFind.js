'use strict';
const TARGETS = new Set(['browser', 'media-manager', 'integrations']);
function createWorkspaceFind({ ipcMain, getWindow, targets, trustedDesktop }) {
  let active = null, pending = null;
  const watched = new WeakSet();
  const host = () => { const win = getWindow(); return win && !win.isDestroyed() ? win.webContents : null; };
  function finish(value) {
    if (!pending) return;
    const request = pending; pending = null; clearTimeout(request.timer); clearTimeout(request.finalTimer);
    request.contents.removeListener('found-in-page', request.listener); request.resolve(value);
  }
  function stop(target, focus = false) {
    if (target && active?.target !== target) return { stopped: true };
    finish({ cancelled: true });
    const previous = active; active = null;
    if (previous && !previous.contents.isDestroyed()) {
      previous.contents.stopFindInPage('clearSelection');
      if (focus && targets[previous.target]?.() === previous.contents) previous.contents.focus();
    }
    return { stopped: true };
  }
  function search(value) {
    if (!value || !TARGETS.has(value.target) || typeof value.query !== 'string' || value.query.length > 200 || /[\u0000-\u0008\u000b-\u001f]/.test(value.query)) return Promise.resolve({ error: 'Choose a valid search target and up to 200 characters.' });
    const contents = targets[value.target]?.();
    if (!contents || contents.isDestroyed()) { stop(); return Promise.resolve({ unavailable: true }); }
    const query = value.query.trim();
    if (!query) { stop(); return Promise.resolve({ matches: 0, current: 0 }); }
    const continuation = value.findNext === true && active?.target === value.target && active.contents === contents && active.query === query && active.matchCase === (value.matchCase === true);
    if (!continuation) stop(); else finish({ cancelled: true });
    active = { target: value.target, contents, query, matchCase: value.matchCase === true };
    return new Promise(resolve => {
      const request = { contents, resolve, requestId: null };
      request.listener = (_event, result) => {
        if (pending !== request || result.requestId !== request.requestId) return;
        clearTimeout(request.finalTimer);
        // Child frames can update Chromium's total after an early final event.
        if (result.finalUpdate) request.finalTimer = setTimeout(() => {
          if (pending === request) finish({ matches: result.matches, current: result.activeMatchOrdinal });
        }, 80);
      };
      request.timer = setTimeout(() => { if (pending === request) { finish({ error: 'Search timed out. Try again.' }); stop(); } }, 5000);
      request.timer.unref?.(); pending = request;
      contents.on('found-in-page', request.listener);
      try { request.requestId = contents.findInPage(query, { forward: value.forward !== false, ...(continuation ? {findNext:true} : {}), matchCase: value.matchCase === true }); }
      catch { finish({ error: 'The page is no longer available. Reopen it and search again.' }); stop(); }
    });
  }
  function watch(contents, target) {
    if (!contents || !TARGETS.has(target) || watched.has(contents)) return; watched.add(contents);
    contents.on('before-input-event', (event, input) => {
      if (targets[target]?.() !== contents || input.type !== 'keyDown') return;
      const mod = input.control || input.meta, key = input.key.toLowerCase();
      if (!input.alt && ((mod && ['f', 'g'].includes(key)) || input.key === 'F3')) {
        event.preventDefault(); const wc = host(); wc?.focus();
        wc?.send('workspace-find:open', { target, ...(key === 'f' ? {} : { direction: input.shift ? -1 : 1 }) });
      } else if (input.key === 'Escape' && active?.contents === contents) { event.preventDefault(); stop(target); host()?.send('workspace-find:close'); }
    });
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace && active?.contents === contents) stop(target); });
    contents.on('did-finish-load', () => host()?.send('workspace-find:open', { target, refresh: true }));
    contents.once('destroyed', () => { if (active?.contents === contents) stop(target); });
  }
  function watchHost(contents) {
    // Keyboard events inside sandboxed previews do not bubble to React.
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && !input.alt && (input.control || input.meta) && input.key.toLowerCase() === 'f'
          && contents.focusedFrame && contents.focusedFrame !== contents.mainFrame) {
        event.preventDefault(); contents.focus(); contents.send('workspace-find:open', {});
      }
    });
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) stop(); });
    contents.on('render-process-gone', () => stop());
    contents.once('destroyed', () => stop());
  }
  ipcMain.handle('workspace-find:search', (event, value) => trustedDesktop(event) ? search(value) : { error: 'Desktop access required.' });
  ipcMain.handle('workspace-find:stop', (event, value) => trustedDesktop(event) && TARGETS.has(value?.target) ? stop(value.target, value.restoreFocus === true) : { error: 'Desktop access required.' });
  return { watch, watchHost, search, stop };
}
module.exports = { createWorkspaceFind };
