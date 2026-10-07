import { useEffect, useRef } from 'react';
import { installPopupDismissal, registerPopupLayer } from './popupDismissal';

export function useAppPopupDismissal() {
  useEffect(() => installPopupDismissal(document), []);
}

export function useDismissiblePopup({ open, container, onDismiss, returnFocus, dismissOnOutside = true }) {
  const latest = useRef(null);
  latest.current = { onDismiss, returnFocus, dismissOnOutside };
  useEffect(() => {
    if (!open) return;
    const openingFocus = document.activeElement;
    return registerPopupLayer(document, {
      node: () => container.current,
      dismiss: reason => {
        if (reason === 'outside' && !latest.current.dismissOnOutside) return;
        latest.current.onDismiss();
        if (reason === 'escape') {
          const focus = latest.current.returnFocus;
          const target = typeof focus === 'function' ? focus() : focus?.current || focus || openingFocus;
          if (target?.isConnected && target.getClientRects().length) target.focus();
        }
      },
    });
  }, [open, container]);
}
