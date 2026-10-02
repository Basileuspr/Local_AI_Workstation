import {describe,it,expect} from 'vitest';
import * as app from '../../src/fileSelection';
import * as media from '../../media-manager/frontend/selection';

// Media Manager is independently runnable, so its bundled helper shares this contract.
for (const [name,api] of [['workstation',app],['media-manager',media]]) describe(name+' file selection',()=>{
  const ordered=['a','b','c','d','e'];
  const pick=(ids,anchor,id,modifiers={},order=ordered,limit=Infinity)=>api.selectFileRange(ids,anchor,order,id,modifiers,limit);
  it('toggles one item without changing other selections',()=>{
    expect([...pick(['a','hidden'],'a','c',{additive:true}).ids]).toEqual(['a','hidden','c']);
    expect([...pick(['a','c'],'a','c',{additive:true}).ids]).toEqual(['a']);
  });
  it('selects inclusive forward and backward ranges in displayed order',()=>{
    expect([...pick(['e'],'b','d',{shift:true}).ids]).toEqual(['b','c','d']);
    expect([...pick(['a'],'d','b',{shift:true}).ids]).toEqual(['b','c','d']);
    expect([...pick([],'d','b',{shift:true},['d','a','c','b']).ids]).toEqual(['d','a','c','b']);
  });
  it('keeps the anchor while a repeated Shift click shrinks or reverses a range',()=>{
    const first=pick(['b'],'b','e',{shift:true});
    const second=pick(first.ids,first.anchor,'c',{shift:true});
    expect(second.anchor).toBe('b');expect([...second.ids]).toEqual(['b','c']);
    expect([...pick(second.ids,second.anchor,'a',{shift:true}).ids]).toEqual(['a','b']);
  });
  it('Ctrl+Shift adds a range and preserves off-page selections',()=>{
    expect([...pick(['hidden','e'],'a','c',{shift:true,additive:true}).ids]).toEqual(['hidden','e','a','b','c']);
  });
  it('does not select filtered-out items or use an anchor absent from the current page',()=>{
    expect([...pick(['a'],'a','d',{shift:true},['a','c','d']).ids]).toEqual(['a','c','d']);
    const fresh=pick(['a'],'a','e',{shift:true},['d','e']);
    expect([...fresh.ids]).toEqual(['e']);expect(fresh.anchor).toBe('e');
    expect([...pick(['a'],'a','missing',{shift:true}).ids]).toEqual(['a']);
  });
  it('limits additions without dropping existing selections or changing its inputs',()=>{
    const original=new Set(['hidden']);const next=pick(original,'a','e',{shift:true,additive:true},ordered,3);
    expect([...next.ids]).toEqual(['hidden','a','b']);expect([...original]).toEqual(['hidden']);
  });
  it('reads real click modifiers including React native events and Mac Command',()=>{
    expect(api.selectionModifiers({nativeEvent:{shiftKey:true,ctrlKey:true}})).toEqual({shift:true,additive:true});
    expect(api.selectionModifiers({metaKey:true})).toEqual({shift:false,additive:true});
    expect(api.hasSelectionModifier({})).toBe(false);
  });
});
