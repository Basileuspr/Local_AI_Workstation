import { useEffect, useRef } from "react";
import { clampLayoutValue } from "../workspaceLayout";

export default function ResizableDivider({ label, orientation = "vertical", value, min, max, defaultValue,
  step = 1, valueText, controls, className = "", hidden = false, onChange, onDragging, pointerValue }) {
  const drag = useRef(null);
  const callbacks = useRef({ onChange, onDragging });
  callbacks.current = { onChange, onDragging };
  useEffect(() => () => { if (drag.current) callbacks.current.onDragging?.(false); }, []);

  function change(next) { onChange(clampLayoutValue(next, min, max)); }
  function finish(event, cancel = false) {
    if (!drag.current || (event.pointerId !== undefined && event.pointerId !== drag.current.id)) return;
    const previous = drag.current;
    drag.current = null;
    if (cancel) change(previous.value);
    onDragging?.(false);
    if (event.currentTarget.hasPointerCapture?.(previous.id)) event.currentTarget.releasePointerCapture(previous.id);
  }
  function handleKey(event) {
    if (event.key === "Escape" && drag.current) { event.preventDefault(); finish(event, true); return; }
    const backward = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const forward = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    let next;
    if (event.key === backward) next = value - step * (event.shiftKey ? 5 : 1);
    else if (event.key === forward) next = value + step * (event.shiftKey ? 5 : 1);
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "Enter") next = defaultValue;
    else return;
    event.preventDefault();
    change(next);
  }
  return <div role="separator" tabIndex={hidden ? -1 : 0} hidden={hidden}
    className={`workspace-divider ${className}`} aria-label={label} aria-orientation={orientation}
    aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)}
    aria-valuetext={valueText} aria-controls={controls}
    title="Drag to resize. Arrow keys adjust; double-click or Enter resets."
    onKeyDown={handleKey} onDoubleClick={() => change(defaultValue)}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { id: event.pointerId, value };
      event.currentTarget.setPointerCapture(event.pointerId);
      onDragging?.(true);
    }}
    onPointerMove={event => { if (drag.current?.id === event.pointerId) change(pointerValue(event)); }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => finish(event)} />;
}
