import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ImageManager from '../../src/components/ImageManager';
import { NO_IMAGE_FOLDER } from '../../src/imageManagerApi';

vi.mock('../../src/components/ImageThumbnail', () => ({ default: () => null }));
vi.mock('../../src/components/VisualReview', () => ({ default: () => null }));
vi.mock('../../src/useStore', () => ({ useDispatch: () => vi.fn() }));
vi.mock('../../src/ImageDestinations', () => ({ useImageDestinations: () => ({}) }));

let root, window, document, catalog, forgetError;
const folders = [
  { id: 'source', path: 'C:/fixture/photos', purpose: 'source', count: 1 },
  { id: 'output', path: 'C:/fixture/organized', purpose: 'output', count: 1 },
  { id: 'other-output', path: 'C:/fixture/copies', purpose: 'output', count: 1 },
];
const image = { id: 'image', folder_id: 'output', folder_path: folders[1].path, relative: 'photo.png', width: 16, height: 16, bytes: 100, format: 'PNG', date: '2026-01-01', tags: [] };
const emptyPage = { images: [], total: 0, months: [], formats: [], tags: [] };
const response = value => ({ ok: true, json: async () => value });

beforeEach(() => {
  vi.useFakeTimers();
  ({ window, document } = parseHTML('<html><body><main id="root"></main></body></html>'));
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  catalog = { folders: [...folders], summary: { images: 3, bytes: 300, favorites: 0, hidden: 1 }, functions: [], duplicates: [{ sha256: 'hash', count: 2, bytes: 100 }], receipts: [], plans: [] };
  forgetError = '';
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (options.method === 'DELETE') {
      if (forgetError) return { ok: false, json: async () => ({ detail: forgetError }) };
      catalog.folders = catalog.folders.filter(folder => !path.endsWith(`/${folder.id}`));
      return response({ ok: true });
    }
    if (path.endsWith('/state')) return response(structuredClone(catalog));
    if (path.endsWith('/image-tools/sources')) return response({ images: [image] });
    if (path.endsWith('/images')) return response({ ...emptyPage, images: [image], total: 1 });
    throw new Error(`Unexpected request: ${options.method} ${path}`);
  }));
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete window.HTMLElement.prototype.showModal;
  vi.useRealTimers(); vi.unstubAllGlobals();
});
async function mount() { await act(async () => root.render(<ImageManager/>)); await tick(); }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); }
const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(node => node.textContent === text);
const imageRequests = () => fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/images'));
async function select(label, value) {
  await act(async () => {
    const field = document.querySelector(`[aria-label="${label}"]`);
    for (const option of field.querySelectorAll('option')) option.selected = false;
    field.querySelector(`option[value="${value}"]`).selected = true;
    field.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await tick();
}
async function click(node) { await act(async () => node.click()); }

it('starts unpointed with all three saved folders manageable, including output-only folders', async () => {
  await mount();
  expect(document.querySelector('[aria-label="Filter image folder"]').value).toBe(NO_IMAGE_FOLDER);
  expect(imageRequests()).toHaveLength(0);
  expect(document.querySelectorAll('.im-folder-list > div')).toHaveLength(3);
  expect(document.querySelectorAll('.im-folder-list input')).toHaveLength(1);
  expect(document.querySelectorAll('.im-folder-list button')).toHaveLength(3);
  expect(button('Scan folders').disabled).toBe(true);
  expect(button('Hide tagged images').disabled).toBe(true);
  expect(button('Unhide images').disabled).toBe(true);
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});

it('clears browsing, selected images and bulk actions without forgetting saved metadata', async () => {
  await mount(); await select('Filter image folder', 'output');
  expect(new URL(imageRequests().at(-1)[0]).searchParams.get('folder_id')).toBe('output');
  await click(document.querySelector('.im-select input'));
  expect(document.querySelector('.im-selection').textContent).toContain('1 selected');
  const count = imageRequests().length;
  await select('Filter image folder', NO_IMAGE_FOLDER);
  expect(document.querySelectorAll('.im-grid article')).toHaveLength(0);
  expect(document.querySelector('.im-selection').textContent).toContain('0 selected');
  expect(imageRequests()).toHaveLength(count);
  expect(button('Hide tagged images').disabled).toBe(true);
  expect(catalog.folders).toHaveLength(3);
  expect(fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);
  await select('Filter image folder', '');
  expect(new URL(imageRequests().at(-1)[0]).searchParams.get('folder_id')).toBe('');
  await click(button('Reset filters')); await tick();
  expect(document.querySelector('[aria-label="Filter image folder"]').value).toBe(NO_IMAGE_FOLDER);
  expect(document.querySelectorAll('.im-grid article')).toHaveLength(0);
});

it('ignores a late image response after browsing has been cleared', async () => {
  await mount();
  let finish;
  const original = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => new URL(url).pathname.endsWith('/images') ? new Promise(resolve => { finish = resolve; }) : original(url, options));
  await select('Filter image folder', 'output');
  await select('Filter image folder', NO_IMAGE_FOLDER);
  await act(async () => finish(response({ ...emptyPage, images: [image], total: 1 })));
  expect(document.querySelectorAll('.im-grid article')).toHaveLength(0);
});

it('confirms forgetting an output folder and clears its browsing and output selections', async () => {
  await mount(); await select('Filter image folder', 'output');
  const output = document.querySelector('.im-folders > label select');
  await act(async () => {
    for (const option of output.querySelectorAll('option')) option.selected = false;
    output.querySelector('option[value="output"]').selected = true;
    output.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await click(document.querySelector('[aria-label="Forget C:/fixture/organized"]'));
  await click(button('Cancel', document.querySelector('dialog')));
  expect(fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);
  await click(document.querySelector('[aria-label="Forget C:/fixture/organized"]'));
  await click(button('Forget folder', document.querySelector('dialog'))); await tick();
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1);
  expect(catalog.folders.map(folder => folder.id)).toEqual(['source', 'other-output']);
  expect(document.querySelector('[aria-label="Filter image folder"]').value).toBe(NO_IMAGE_FOLDER);
  expect(output.value).toBe('');
  expect(document.querySelectorAll('.im-grid article')).toHaveLength(0);
  expect(document.querySelector('dialog')).toBeNull();
});

it('shows a blocked forget reason inside the open dialog and retains the folder', async () => {
  forgetError = "Restore this folder's deleted images from Trash before forgetting it.";
  await mount(); await click(document.querySelector('[aria-label="Forget C:/fixture/organized"]'));
  await click(button('Forget folder', document.querySelector('dialog')));
  expect(document.querySelector('dialog [role="alert"]').textContent).toBe(forgetError);
  expect(catalog.folders).toHaveLength(3);
});

it('does not silently choose the first source when opening Image tools without a folder', async () => {
  await mount(); await click(button('Image tools'));
  expect(document.querySelector('[aria-label="Image tools source"]').value).toBe('');
  expect(fetch.mock.calls.some(([url]) => url.includes('/image-tools/sources'))).toBe(false);
  expect(button('Read image folder', document.querySelector('dialog')).disabled).toBe(true);
});

it('uses an explicit all-folder scope when opening duplicate results', async () => {
  await mount(); await click(button('Duplicates'));
  await click(button('Show all checked duplicates')); await tick();
  expect(new URL(imageRequests().at(-1)[0]).searchParams.get('folder_id')).toBe('');
  expect(new URL(imageRequests().at(-1)[0]).searchParams.get('duplicates')).toBe('true');
});
