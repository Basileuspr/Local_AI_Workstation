import { useReducer, useState } from 'react';
import { sourceFor } from './imageLibraryApi';

export function stitchKey(image) {
  const { name, ...source } = sourceFor(image);
  return JSON.stringify(source);
}

export function selectionInPickOrder(selection) {
  const items = new Map(selection.items.map(image => [image.id, image]));
  return [...selection.ids].map(id => items.get(id)).filter(Boolean);
}

export const initialStitchState = { frames: [], enabled: false, open: false, error: '' };
export function stitchReducer(state, action) {
  if (action.type === 'add') {
    const frames = [...state.frames], keys = new Set(frames.map(stitchKey));
    for (const image of action.images) {
      const key = stitchKey(image);
      if (!keys.has(key)) { frames.push(image); keys.add(key); }
    }
    return { ...state, frames, enabled: true, error: '' };
  }
  if (action.type === 'remove') return { ...state, frames: state.frames.filter(image => stitchKey(image) !== action.key), error: '' };
  if (action.type === 'move') {
    const frames = [...state.frames], index = frames.findIndex(image => stitchKey(image) === action.key), next = index + action.direction;
    if (index < 0 || next < 0 || next >= frames.length) return state;
    [frames[index], frames[next]] = [frames[next], frames[index]];
    return { ...state, frames };
  }
  if (action.type === 'reverse') return { ...state, frames: [...state.frames].reverse() };
  if (action.type === 'clear') return { ...state, frames: [], error: '' };
  return { ...state, ...action.value };
}

export function useImageStitcher() {
  const [state, dispatch] = useReducer(stitchReducer, initialStitchState);
  const [busy, setBusy] = useState(false);
  const send = action => { if (!busy) dispatch(action); };
  return { ...state, busy, setBusy,
    number: image => state.frames.findIndex(frame => stitchKey(frame) === stitchKey(image)) + 1,
    add: images => send({ type: 'add', images }),
    toggle: image => send(state.frames.some(frame => stitchKey(frame) === stitchKey(image))
      ? { type: 'remove', key: stitchKey(image) } : { type: 'add', images: [image] }),
    remove: image => send({ type: 'remove', key: stitchKey(image) }),
    move: (image, direction) => send({ type: 'move', key: stitchKey(image), direction }),
    reverse: () => send({ type: 'reverse' }), clear: () => send({ type: 'clear' }),
    setEnabled: enabled => send({ value: { enabled } }), setOpen: open => dispatch({ value: { open } }),
  };
}
