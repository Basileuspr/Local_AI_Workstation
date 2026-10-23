import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach, expect, it, vi} from 'vitest';
import ClientUpdate from '../../web/src/ClientUpdate';
import {applyClientUpdate} from '../../web/src/clientVersion';

let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.unstubAllGlobals(); });
const version = 'b'.repeat(24);

it('keeps drafts until explicitly accepted and blocks unresolved submissions', async () => {
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const apply = vi.fn();
  root = createRoot(dom.document.getElementById('root'));
  const render = props => act(async () => root.render(<ClientUpdate version={version} apply={apply} hasDraft {...props} />));
  const button = text => [...dom.document.querySelectorAll('button')].find(item => item.textContent === text);
  await render({blocked: true});
  expect(button('Update phone app').disabled).toBe(true);
  await render({blocked: false});
  expect(apply).not.toHaveBeenCalled();
  await act(async () => button('Update phone app').click());
  expect(apply).not.toHaveBeenCalled();
  expect(dom.document.body.textContent).toContain('Updating clears the prompts');
  await act(async () => button('Keep editing').click());
  expect(apply).not.toHaveBeenCalled();
  await act(async () => button('Update phone app').click());
  await act(async () => button('Update and clear drafts').click());
  expect(apply).toHaveBeenCalledExactlyOnceWith(version);
});

it('navigates past an older worker without clearing pairing or local storage', async () => {
  const navigate = vi.fn(), update = vi.fn(async () => {}), register = vi.fn(async () => ({update}));
  await applyClientUpdate(version, {worker: {register}, navigate});
  expect(register).toHaveBeenCalledWith('/sw.js', {updateViaCache: 'none'});
  expect(update).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith('/?client-update=' + version);
  await expect(applyClientUpdate('../bad', {worker: null, navigate})).rejects.toThrow('unavailable');
  expect(navigate).toHaveBeenCalledOnce();
});

it('supports WebViews without workers and still reloads when worker update fails', async () => {
  const navigate = vi.fn();
  await applyClientUpdate(version, {worker: null, navigate});
  await applyClientUpdate(version, {worker: {register: async () => { throw Error('offline worker'); }}, navigate});
  expect(navigate).toHaveBeenCalledTimes(2);
});
