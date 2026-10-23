import {afterEach, describe, it, expect, vi} from 'vitest';
import {observeScrollToolbar} from '../../src/scrollToolbar';

afterEach(()=>vi.unstubAllGlobals());
function fixture(height=400) {
  const callbacks=[];
  vi.stubGlobal('ResizeObserver',class { constructor(callback){callbacks.push(callback);} observe(){} unobserve(){} disconnect(){} });
  vi.stubGlobal('getComputedStyle',node=>({overflowY:node.scroll?'auto':'visible'}));
  const pane={clientHeight:height,scroll:true,style:{scrollPaddingTop:'4px'},parentElement:{}};
  function toolbar(order,height=70){const values={};return {order,parentElement:pane,style:{setProperty:(key,value)=>{values[key]=value;}},values,
    visible:true,getClientRects(){return this.visible?[{}]:[];},compareDocumentPosition:other=>order<other.order?4:2,
    getBoundingClientRect(){return {height:Math.min(height,parseFloat(values['--toolbar-limit']))};}};}
  return {pane,toolbar,resize:()=>callbacks.forEach(callback=>callback())};
}
describe('controls in scrolling panes',()=>{
  it('shares a bounded portion of the actual pane and stacks later groups without overlap',()=>{
    const f=fixture(),first=f.toolbar(1),second=f.toolbar(2,120);
    const removeFirst=observeScrollToolbar(first),removeSecond=observeScrollToolbar(second);
    expect(first.values['--toolbar-limit']).toBe('77px');
    expect(first.values['--toolbar-top']).toBe('0px');expect(second.values['--toolbar-top']).toBe('76px');
    expect(parseFloat(f.pane.style.scrollPaddingTop)).toBeLessThanOrEqual(166);
    f.pane.clientHeight=180;f.resize();
    expect(second.values['--toolbar-top']).toBe('48px');expect(second.values['--toolbar-limit']).toBe('42px');
    removeSecond();expect(first.values['--toolbar-limit']).toBe('72px');
    removeFirst();expect(f.pane.style.scrollPaddingTop).toBe('4px');
  });
  it('excludes hidden views and measures them again when the workspace returns',()=>{
    const f=fixture(600),a=f.toolbar(1),b=f.toolbar(2);b.visible=false;
    const offA=observeScrollToolbar(a),offB=observeScrollToolbar(b);
    expect(a.values['--toolbar-limit']).toBe('240px');
    b.visible=true;f.resize();expect(a.values['--toolbar-limit']).toBe('117px');
    offA();offB();
  });
  it('keeps split panes independent',()=>{
    const f=fixture(200),g=fixture(800),a=f.toolbar(1),b=g.toolbar(1);
    const offA=observeScrollToolbar(a),offB=observeScrollToolbar(b);
    expect(a.values['--toolbar-limit']).toBe('80px');expect(b.values['--toolbar-limit']).toBe('320px');offA();offB();
  });
});
