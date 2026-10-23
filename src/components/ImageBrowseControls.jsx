export function imageBrowseDirection(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable=true]')) return 0;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
}

export function ImageBrowseButton({ direction, disabled, onStep }) {
  return <button type="button" className={`image-viewer-arrow ${direction < 0 ? 'previous' : 'next'}`}
    aria-label={direction < 0 ? 'Previous image' : 'Next image'} disabled={disabled}
    onClick={() => onStep(direction)}>{direction < 0 ? '‹' : '›'}</button>;
}
