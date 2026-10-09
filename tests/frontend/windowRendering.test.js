import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWindowLayout, installWindowRepaint, WINDOW_LAYOUT_EVENT } from '../../src/windowRendering';
const require = createRequire(import.meta.url);
const { configureRendering, attachWindowRendering } = require('../../electron/windowRendering');
const folders = [];
afterEach(() => { vi.useRealTimers(); for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

function configuration(platform = 'win32', overrides = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'law-rendering-test-')); folders.push(folder);
  const app = { getPath: () => folder, commandLine: { appendSwitch: vi.fn() }, disableHardwareAcceleration: vi.fn() };
  return { app, folder, options: { app, platform, environment: {}, args: [], ...overrides } };
}
describe('persistent desktop rendering', () => {
  it('paints Windows page tiles on the CPU while retaining GPU composition/video/3D', () => {
    const { app, options } = configuration();
    expect(configureRendering(options).state().activeMode).toBe('compatible');
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-direct-composition');
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-gpu-rasterization');
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
  });
  it.each(['darwin', 'linux'])('keeps platform rendering on %s', platform => {
    const { app, options, folder } = configuration(platform);
    fs.writeFileSync(path.join(folder, 'window-rendering.json'), JSON.stringify({ mode: 'compatible' }));
    expect(configureRendering(options).state().activeMode).toBe('hardware');
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(() => configureRendering(options).save('compatible')).toThrow('supported');
  });
  it('saves software mode for the next launch without changing this session', () => {
    const { app, options } = configuration();
    const controller = configureRendering(options);
    expect(controller.save('software')).toMatchObject({ activeMode: 'compatible', savedMode: 'software', restartRequired: true });
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(configureRendering(options).state()).toMatchObject({ activeMode: 'software', restartRequired: false });
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    controller.save('hardware');
    expect(configureRendering(options).state().activeMode).toBe('hardware');
  });
  it.each([{ environment: { LAW_DISABLE_GPU: '1' } }, { args: ['--law-software-rendering'] }])('honors explicit software startup overrides: %j', overrides => {
    const { app, options } = configuration('win32', overrides);
    const controller = configureRendering(options);
    expect(controller.state()).toMatchObject({ activeMode: 'software', forcedSoftware: true });
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(controller.save('hardware')).toMatchObject({ activeMode: 'software', savedMode: 'hardware', restartRequired: true });
  });
  it('recovers from corrupted preferences and rejects arbitrary flags', () => {
    const { options, folder } = configuration();
    fs.writeFileSync(path.join(folder, 'window-rendering.json'), '{broken');
    const controller = configureRendering(options);
    expect(controller.state().activeMode).toBe('compatible');
    expect(() => controller.save('--no-sandbox')).toThrow('supported');
    controller.save('software');
    expect(fs.readdirSync(folder)).toEqual(['window-rendering.json']);
  });
  it('keeps the old preference and status if saving fails', () => {
    const { options, folder } = configuration();
    const controller = configureRendering(options); controller.save('hardware');
    const destination = path.join(folder, `window-rendering.json.${process.pid}.tmp`);
    fs.mkdirSync(destination);
    expect(() => controller.save('software')).toThrow();
    expect(controller.state().savedMode).toBe('hardware');
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'window-rendering.json'))).mode).toBe('hardware');
  });
});

function nativeWindow() {
  const window = new EventEmitter(), screen = new EventEmitter(), wc = new EventEmitter();
  let shown = true, minimized = false, destroyed = false;
  let display = { id: 1, scaleFactor: 1, rotation: 0 };
  window.webContents = wc; wc.isDestroyed = () => destroyed;
  wc.setBackgroundThrottling = vi.fn(); wc.send = vi.fn(); wc.invalidate = vi.fn();
  window.isVisible = () => shown; window.isMinimized = () => minimized; window.isDestroyed = () => destroyed;
  window.getBounds = () => ({ x: 0, y: 0, width: 1200, height: 800 });
  screen.getDisplayMatching = () => display;
  return { window, screen, wc, show: value => { shown = value; }, minimize: value => { minimized = value; },
    destroy: () => { destroyed = true; window.emit('closed'); }, display: value => { display = { ...display, ...value }; } };
}
describe('window drawing and display lifecycle', () => {
  it('lets native video present frames without passive full-window repaint recovery, retaining explicit redraws',()=>{
    vi.useFakeTimers();const mock=nativeWindow(),child=new EventEmitter();
    child.isDestroyed=()=>false;child.setBackgroundThrottling=vi.fn();
    mock.window.contentView={children:[{webContents:child,getVisible:()=>true}]};
    const controller=attachWindowRendering(mock);
    vi.advanceTimersByTime(200);child.emit('media-started-playing');mock.wc.invalidate.mockClear();
    for(let i=0;i<20;i++){controller.repaint({passive:true});vi.advanceTimersByTime(500);}
    expect(mock.wc.invalidate).not.toHaveBeenCalled();expect(controller.state().nativeMediaPlaying).toBe(true);
    controller.repaint();vi.advanceTimersByTime(80);expect(mock.wc.invalidate).toHaveBeenCalledOnce();
    child.emit('media-paused');vi.advanceTimersByTime(1000);expect(mock.wc.invalidate.mock.calls.length).toBeGreaterThan(1);
    child.emit('destroyed');expect(child.eventNames()).toEqual([]);mock.destroy();expect(vi.getTimerCount()).toBe(0);
  });
  it('allows the first hidden window to paint before ready-to-show, then sleeps in the tray', () => {
    vi.useFakeTimers(); const mock = nativeWindow(); mock.show(false);
    attachWindowRendering(mock); mock.wc.emit('did-finish-load');
    expect(mock.wc.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
    mock.show(true); mock.window.emit('show');
    expect(mock.wc.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
    mock.show(false); mock.window.emit('hide');
    expect(mock.wc.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    mock.destroy();
  });
  it('keeps visible drawing active and sleeps hidden or minimized windows', () => {
    vi.useFakeTimers(); const mock = nativeWindow();
    attachWindowRendering(mock);
    expect(mock.wc.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
    mock.show(false); mock.window.emit('hide'); vi.runAllTimers(); expect(mock.wc.send).not.toHaveBeenCalled();
    expect(mock.wc.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    mock.show(true); mock.window.emit('show'); vi.runAllTimers(); expect(mock.wc.send).toHaveBeenCalledWith('app:window-layout');
    mock.minimize(true); mock.window.emit('minimize'); expect(mock.wc.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    mock.minimize(false); mock.window.emit('restore'); expect(mock.wc.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
  });
  it('coalesces menu/focus and scale/zoom changes, ignoring ordinary window movement', () => {
    vi.useFakeTimers(); const mock = nativeWindow(); const controller = attachWindowRendering(mock);
    vi.runAllTimers(); mock.wc.send.mockClear();
    for (let i = 0; i < 20; i++) mock.window.emit('move');
    vi.runAllTimers(); expect(mock.wc.send).not.toHaveBeenCalled();
    mock.display({ id: 2, scaleFactor: 1.5 }); mock.window.emit('move');
    mock.window.emit('focus'); mock.wc.emit('zoom-changed'); controller.refresh();
    vi.runAllTimers(); expect(mock.wc.send).toHaveBeenCalledTimes(1);
    mock.screen.emit('display-metrics-changed', {}, { id: 8 }); vi.runAllTimers(); expect(mock.wc.send).toHaveBeenCalledTimes(1);
    mock.screen.emit('display-metrics-changed', {}, { id: 2 }); vi.runAllTimers(); expect(mock.wc.send).toHaveBeenCalledTimes(2);
  });
  it('cancels pending work and releases global listeners when the window closes', () => {
    vi.useFakeTimers(); const mock = nativeWindow(); const controller = attachWindowRendering(mock);
    mock.destroy(); vi.runAllTimers(); controller.refresh(); vi.runAllTimers();
    expect(mock.wc.send).not.toHaveBeenCalled();
    expect(mock.screen.eventNames()).toEqual([]); expect(mock.wc.eventNames()).toEqual([]); expect(mock.window.eventNames()).toEqual([]);
  });
  it('requests real native repaints, coalesces bursts, and remains idle on static primary tabs', () => {
    vi.useFakeTimers(); const mock = nativeWindow(); const controller = attachWindowRendering(mock);
    vi.runAllTimers(); mock.wc.invalidate.mockClear();
    for (let i = 0; i < 100; i++) controller.repaint();
    vi.advanceTimersByTime(80); expect(mock.wc.invalidate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000); expect(mock.wc.invalidate).toHaveBeenCalledTimes(1);
    mock.show(false); mock.window.emit('hide'); controller.repaint(); vi.runAllTimers();
    expect(mock.wc.invalidate).toHaveBeenCalledTimes(1);
  });
  it('covers visible native child text and stops their recovery timer when hidden or closed', () => {
    vi.useFakeTimers(); const mock = nativeWindow(); let childShown = true;
    const childContents = { isDestroyed: () => false, setBackgroundThrottling: vi.fn() };
    mock.window.contentView = { children: [{ webContents: childContents, getVisible: () => childShown }] };
    const controller = attachWindowRendering(mock);
    vi.advanceTimersByTime(200); const first = mock.wc.invalidate.mock.calls.length;
    vi.advanceTimersByTime(500); expect(mock.wc.invalidate.mock.calls.length).toBeGreaterThan(first);
    childShown = false; vi.advanceTimersByTime(1000); const hidden = mock.wc.invalidate.mock.calls.length;
    vi.advanceTimersByTime(5000); expect(mock.wc.invalidate.mock.calls.length).toBe(hidden);
    childShown = true; controller.repaint(); mock.show(false); mock.window.emit('hide');
    vi.advanceTimersByTime(1000); expect(mock.wc.invalidate.mock.calls.length).toBe(hidden);
    expect(childContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    mock.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
});

function changingPage() {
  const window = new EventTarget(), document = new EventTarget(), frames = new Map();
  const root = { nodeType: 1, parentElement: null, closest: () => null };
  document.documentElement = root; document.visibilityState = 'visible';
  let observer, nextFrame = 0;
  Object.assign(window, { document, Event, workstationDesktop: { repaintWindow: vi.fn() },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id),
    MutationObserver: class { constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observer = this; } } });
  const controller = installWindowRepaint(window);
  const flush = () => { vi.advanceTimersByTime(100); const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  return { window, document, root, observer, frames, controller, flush };
}

describe('redrawing text and controls without resizing or replacing the page', () => {
  it('distinguishes passive clock/content updates from interaction and keeps an interaction queued during a content burst',()=>{
    vi.useFakeTimers();const mock=changingPage();
    mock.observer.callback([{type:'characterData',target:{nodeType:3,parentElement:mock.root}}]);mock.flush();
    expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenLastCalledWith('content');
    mock.document.dispatchEvent(new Event('input'));mock.observer.callback([{type:'childList',target:mock.root}]);mock.flush();
    expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenLastCalledWith('interaction');mock.controller();
  });
  it('observes streaming text and merges many changes into one repaint after rendering', () => {
    vi.useFakeTimers(); const mock = changingPage();
    expect(mock.observer.observe).toHaveBeenCalledWith(mock.root, expect.objectContaining({ characterData: true, childList: true, subtree: true }));
    const text = { nodeType: 3, parentElement: mock.root };
    for (let i = 0; i < 100; i++) mock.observer.callback([{ type: 'characterData', target: text }]);
    expect(mock.window.workstationDesktop.repaintWindow).not.toHaveBeenCalled();
    mock.flush(); expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenCalledTimes(1);
    mock.flush(); expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenCalledTimes(1);
    mock.controller();
  });
  it('covers native select/input properties, menu closure, hover and scrolling', () => {
    vi.useFakeTimers(); const mock = changingPage();
    for (const type of ['input', 'change', 'keyup', 'pointerover', 'toggle', 'scroll']) { mock.document.dispatchEvent(new Event(type)); mock.flush(); }
    expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenCalledTimes(6);
    mock.controller();
  });
  it('skips hidden workspaces but repaints when a visible section is folded away', () => {
    vi.useFakeTimers(); const mock = changingPage();
    const hidden = { nodeType: 1, parentElement: { closest: () => ({ hidden: true }) }, closest: () => ({ hidden: true }) };
    mock.observer.callback([{ type: 'characterData', target: { nodeType: 3, parentElement: hidden } }]); mock.flush();
    expect(mock.window.workstationDesktop.repaintWindow).not.toHaveBeenCalled();
    const folded = { nodeType: 1, parentElement: mock.root, closest: () => ({ hidden: true }) };
    mock.observer.callback([{ type: 'attributes', target: folded }]); mock.flush();
    expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenCalledTimes(1); mock.controller();
  });
  it('cancels queued work for tray/minimize and releases every observer and listener', () => {
    vi.useFakeTimers(); const mock = changingPage();
    mock.document.dispatchEvent(new Event('input')); vi.advanceTimersByTime(100); expect(mock.frames.size).toBe(1);
    mock.document.visibilityState = 'hidden'; mock.document.dispatchEvent(new Event('visibilitychange')); expect(mock.frames.size).toBe(0);
    mock.observer.callback([{ type: 'childList', target: mock.root }]); mock.flush(); expect(mock.window.workstationDesktop.repaintWindow).not.toHaveBeenCalled();
    mock.document.visibilityState = 'visible'; mock.document.dispatchEvent(new Event('visibilitychange')); mock.flush();
    expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenCalledTimes(1);
    mock.document.dispatchEvent(new Event('input')); mock.controller(); mock.flush();
    expect(mock.observer.disconnect).toHaveBeenCalledOnce();
    mock.document.dispatchEvent(new Event('change')); mock.flush(); expect(mock.window.workstationDesktop.repaintWindow).toHaveBeenCalledTimes(1);
  });
});

describe('renderer geometry notifications', () => {
  it('has no desktop side effects in a browser', () => { expect(installWindowLayout({})()).toBeUndefined(); });
  it('merges restore/DPI notifications into a frame and cleans up', () => {
    const window = new EventTarget(), document = new EventTarget(), frames = new Map(), queries = [];
    let notify; const remove = vi.fn();
    Object.assign(window, { document, Event, devicePixelRatio: 1,
      workstationDesktop: { onWindowLayout: listener => { notify = listener; return remove; } },
      requestAnimationFrame: fn => { frames.set(1, fn); return 1; }, cancelAnimationFrame: key => frames.delete(key),
      matchMedia: () => { const query = new EventTarget(); queries.push(query); return query; } });
    document.visibilityState = 'visible'; const event = vi.fn(); window.addEventListener(WINDOW_LAYOUT_EVENT, event);
    const dispose = installWindowLayout(window);
    notify(); notify(); expect(frames.size).toBe(1); frames.get(1)(); frames.clear(); expect(event).toHaveBeenCalledTimes(1);
    window.devicePixelRatio = 1.5; queries[0].dispatchEvent(new Event('change'));
    expect(queries).toHaveLength(2); frames.get(1)(); frames.clear(); expect(event).toHaveBeenCalledTimes(2);
    document.visibilityState = 'hidden'; notify(); expect(frames.size).toBe(0);
    document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); expect(frames.size).toBe(1);
    dispose(); expect(frames.size).toBe(0); expect(remove).toHaveBeenCalledOnce(); notify(); expect(frames.size).toBe(0);
  });
});
