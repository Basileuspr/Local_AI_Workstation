import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {workspaceVisible} from '../../src/chatPins';

const mocks = vi.hoisted(() => ({session: vi.fn(), library: vi.fn(), dispatch: vi.fn(), media: null, detach: vi.fn()}));
vi.mock('../../src/api', () => ({listSessionImages: mocks.session}));
vi.mock('../../src/useStore', () => ({useDispatch: () => mocks.dispatch}));
vi.mock('../../src/imageLibraryApi', () => ({list: mocks.library, imageUrl: image => image}));
vi.mock('../../src/appPolling', () => ({mediaJobsObserver: () => ({subscribe: listener => {mocks.media = listener; return mocks.detach;}})}));

let root, useSessionGallery, useImageLibrary, gallery, library;
function Harness({primary = 'generate', pin = null, owned = false}) {
  const active = workspaceVisible(primary, primary === 'chats' ? pin : null, 'images', primary === 'chats' ? null : pin);
  gallery = useSessionGallery(active);
  library = useImageLibrary(active && owned, {watchMedia: true});
  return <div>{gallery.error || library.error}</div>;
}
const render = async props => {await act(async () => root.render(<Harness {...props}/>));};
const tick = async () => {await act(async () => vi.advanceTimersByTimeAsync(0));};
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  const {window, document} = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  ({default: useSessionGallery} = await import('../../src/useSessionGallery'));
  ({default: useImageLibrary} = await import('../../src/useImageLibrary'));
  mocks.session.mockResolvedValue([{id: 'existing'}]);
  mocks.library.mockResolvedValue({images: [], folders: [], tags: []});
  mocks.media = null; root = createRoot(document.getElementById('root'));
});
afterEach(async () => {await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals();});

it.each(['generate', 'chats'])('loads and refreshes Gallery beside %s without opening Gallery as the main tab', async primary => {
  await render({primary}); await tick(); expect(mocks.session).not.toHaveBeenCalled();
  await render({primary, pin: {kind: 'tool', tab: 'images'}}); await tick();
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type: 'SET_SESSION_IMAGES', payload: [{id: 'existing'}]});
  mocks.session.mockResolvedValue([{id: 'existing'}, {id: 'completed'}]);
  gallery.refresh(); await tick();
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type: 'SET_SESSION_IMAGES', payload: [{id: 'existing'}, {id: 'completed'}]});
  await render({primary}); const calls = mocks.session.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(mocks.session).toHaveBeenCalledTimes(calls);
});

it('discards a pre-completion response instead of overwriting newer image data', async () => {
  let finish;
  mocks.session.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  await render({primary: 'images'}); await tick();
  gallery.refresh();
  mocks.session.mockResolvedValue([{id: 'new'}]);
  await act(async () => finish([{id: 'stale'}])); await tick();
  expect(mocks.dispatch.mock.calls).toEqual([[{type: 'SET_SESSION_IMAGES', payload: [{id: 'new'}]}]]);
});

it('retains images on disconnection and clears the error on recovery', async () => {
  await render({primary: 'images'}); await tick(); mocks.dispatch.mockClear();
  mocks.session.mockRejectedValue(new Error('Offline')); gallery.refresh(); await tick();
  expect(gallery.error).toContain('last loaded images'); expect(mocks.dispatch).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue([{id: 'recovered'}]); window.dispatchEvent(new window.Event('focus')); await tick();
  expect(gallery.error).toBe('');
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type: 'SET_SESSION_IMAGES', payload: [{id: 'recovered'}]});
});

it('refreshes owned Qwen images on completion while Chat is primary and keeps library errors recoverable', async () => {
  await render({primary: 'chats', pin: {kind: 'tool', tab: 'images'}, owned: true}); await tick();
  await act(async () => mocks.media.data({jobs: [{id: 'qwen', kind: 'image', status: 'running'}]})); await tick();
  const pendingReads = mocks.library.mock.calls.length;
  await act(async () => mocks.media.data({jobs: [{id: 'qwen', kind: 'image', status: 'running', step: 2}]})); await tick();
  expect(mocks.library).toHaveBeenCalledTimes(pendingReads);
  mocks.library.mockResolvedValue({images: [{id: 'qwen-image', url: '/image-library/images/qwen-image/content'}], folders: [], tags: []});
  await act(async () => mocks.media.data({jobs: [{id: 'qwen', kind: 'image', status: 'completed', url: '/media-generation/jobs/qwen/output'}]})); await tick();
  expect(library.images[0]).toMatchObject({id: 'qwen-image', library: true});
  mocks.library.mockRejectedValue(new Error('Library offline')); library.refresh(); await tick();
  expect(library.images).toHaveLength(1); expect(library.error).toBe('Library offline');
  await render({primary: 'chats'}); expect(mocks.detach).toHaveBeenCalledTimes(1);
});
