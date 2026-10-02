import {useEffect, useRef} from 'react';
import {selectFileRange, selectionModifiers} from './fileSelection';

export function useRangeSelection(ordered, selected, setSelected, {scope = '', array = false, limit = Infinity} = {}) {
  const anchor = useRef(null), signature = JSON.stringify(ordered);
  const count = array ? selected.length : selected.size;
  useEffect(() => { anchor.current = null; }, [signature, scope]);
  useEffect(() => { if (!count) anchor.current = null; }, [count]);
  function toggle(id, event) {
    const modifiers = selectionModifiers(event), origin = anchor.current;
    anchor.current = selectFileRange([], origin, ordered, id, modifiers).anchor;
    setSelected(current => {
      const next = selectFileRange(current, origin, ordered, id, modifiers, limit).ids;
      return array ? [...next] : next;
    });
  }
  return {toggle, reset: () => { anchor.current = null; }};
}
