import { afterEach, expect, it, vi } from 'vitest';
import { NO_IMAGE_FOLDER } from '../../src/imageManagerApi';
import { IMAGE_MANAGER_VIEW_KEY, loadImageManagerView, saveImageManagerView } from '../../src/imageManagerViewState';

afterEach(() => vi.unstubAllGlobals());

it('starts unpointed in a new window and tolerates unavailable or damaged storage', () => {
  for (const getItem of [() => null, () => '{', () => { throw Error('Unavailable'); }]) {
    vi.stubGlobal('sessionStorage', { getItem, setItem() { throw Error('Unavailable'); } });
    expect(loadImageManagerView().filters.folder_id).toBe(NO_IMAGE_FOLDER);
    expect(() => saveImageManagerView({})).not.toThrow();
  }
});

it('stores only validated browsing and scan inputs, with no selections or file operations', () => {
  const saved = new Map();
  vi.stubGlobal('sessionStorage', { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) });
  saveImageManagerView({ filters: { folder_id: 'source', favorite: 'false', search: 'x'.repeat(201), sort: 'invalid' },
    sourceIds: ['source', 'source', null, NO_IMAGE_FOLDER], outputId: 'output', recursive: false,
    offset: -1, view: 'invalid', selected: ['image'], plan: { mode: 'move' } });
  const value = loadImageManagerView();
  expect(value.filters).toMatchObject({ folder_id: 'source', search: '', sort: 'date', favorite: false });
  expect(value).toMatchObject({ sourceIds: ['source'], outputId: 'output', recursive: false, offset: 0, view: 'library' });
  expect(JSON.parse(saved.get(IMAGE_MANAGER_VIEW_KEY))).toEqual(value);
  expect(value).not.toHaveProperty('selected'); expect(value).not.toHaveProperty('plan');
});
