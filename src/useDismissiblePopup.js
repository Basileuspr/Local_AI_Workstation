import { useEffect, useRef } from 'react';
import { installPopupDismissal, registerPopupLayer } from './popupDismissal';

export function useAppPopupDismissal() {
  useEffect(() => installPopupDismissal(document), []);
}

export function useDismissiblePopup({ open, container, onDismiss, returnFocus }) {
  const latest = useRef(null);
  latest.current = { onDismiss, returnFocus };
  useEffect(() => {
    if (!open) return;
    const openingFocus = document.activeElement;
    return registerPopupLayer(document, {
      node: () => container.current,
      dismiss: reason => {
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
