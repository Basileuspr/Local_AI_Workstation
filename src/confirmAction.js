import './confirmAction.css';

let pending = Promise.resolve();

// Native synchronous JS dialogs can leave the Windows renderer unable to type.
// A top-layer HTML dialog keeps the same document, selection and input routing.
export function confirmAction(message, {notice = false} = {}) {
  const show = () => new Promise(resolve => {
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'action-confirmation';
    dialog.setAttribute('aria-label', notice ? 'Notice' : 'Confirm action');
    const text = document.createElement('p');
    text.textContent = message;
    const actions = document.createElement('div');
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = notice ? 'Close' : 'Cancel';
    cancel.autofocus = true;
    const accept = document.createElement('button');
    accept.type = 'button'; accept.textContent = 'Confirm';
    cancel.onclick = () => dialog.close('cancel');
    accept.onclick = () => dialog.close('confirm');
    actions.append(cancel);
    if (!notice) actions.append(accept);
    dialog.append(text, actions);
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.remove();
      if (document.hasFocus() && previous?.isConnected && !previous.closest('[hidden], [inert]') && previous.getClientRects().length) previous.focus({preventScroll: true});
      resolve(confirmed);
    }, {once: true});
    document.body.append(dialog);
    dialog.showModal();
  });
  const result = pending.then(show);
  pending = result.catch(() => {});
  return result;
}
