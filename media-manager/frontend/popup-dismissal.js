// Framework-independent: one listener set per document coordinates nested popups, including native
// dialogs and menus rendered through portals.
const documents = new WeakMap();
const visible = node => !!node?.isConnected && node.getClientRects().length > 0;

function coordinator(doc) {
  if (documents.has(doc)) return documents.get(doc);
  const layers = [];
  let clients = 0, backdropStart = null;
  const modal = () => {
    const focused = doc.activeElement?.closest?.('dialog[open]');
    return visible(focused) ? focused : [...doc.querySelectorAll('dialog[open]')].filter(visible).at(-1);
  };
  const outsideBounds = (node, event) => {
    const rect = node.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  function pointer(event) {
    const dialog = modal();
    backdropStart = dialog && event.target === dialog && outsideBounds(dialog, event) ? dialog : null;
    if (dialog) return;
    // Stop at a containing popup. This also keeps a parent menu open when the
    // clicked child is a portal outside the parent's DOM subtree.
    for (const layer of [...layers].reverse()) {
      const node = layer.node();
      if (!visible(node)) continue;
      if (node.contains(event.target)) break;
      layer.dismiss('outside');
    }
  }
  function click(event) {
    const dialog = backdropStart;
    backdropStart = null;
    if (!dialog || modal() !== dialog || event.target !== dialog || !outsideBounds(dialog, event)) return;
    // Use each dialog's existing cancel path, including work already in flight.
    // A synthetic cancel has no native default action, so close explicitly only
    // if its handler did not cancel the request or remove the dialog itself.
    const accepted = dialog.dispatchEvent(new doc.defaultView.Event('cancel', { cancelable: true }));
    if (accepted && dialog.isConnected && dialog.open) dialog.close();
  }
  function keyboard(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || modal()) return;
    const layer = [...layers].reverse().find(item => visible(item.node()));
    if (!layer) return;
    event.preventDefault(); event.stopPropagation();
    layer.dismiss('escape');
  }
  const manager = {
    layers,
    acquire() {
      if (clients++ === 0) {
        doc.addEventListener('pointerdown', pointer, true);
        doc.addEventListener('click', click);
        doc.addEventListener('keydown', keyboard);
      }
      return () => {
        if (--clients === 0) {
          doc.removeEventListener('pointerdown', pointer, true);
          doc.removeEventListener('click', click);
          doc.removeEventListener('keydown', keyboard);
          backdropStart = null;
        }
      };
    },
  };
  documents.set(doc, manager);
  return manager;
}

export function installPopupDismissal(doc) { return coordinator(doc).acquire(); }

export function registerPopupLayer(doc, layer) {
  const manager = coordinator(doc), release = manager.acquire();
  manager.layers.push(layer);
  return () => {
    const index = manager.layers.indexOf(layer);
    if (index >= 0) manager.layers.splice(index, 1);
    release();
  };
}
