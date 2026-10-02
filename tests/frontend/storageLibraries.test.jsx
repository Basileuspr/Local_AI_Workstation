import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import StorageLibraries from '../../src/components/StorageLibraries';
import { addStorageLibrary, setDefaultStorageLibrary, chooseStorageParent, openStorageLibrary, libraryExportFolder } from '../../src/storageLibraries';

afterEach(() => vi.unstubAllGlobals());

it('keeps library management collapsed and does not create folders on render', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const markup = renderToStaticMarkup(<StorageLibraries />);
  expect(markup).toContain('Storage libraries');
  expect(markup).not.toContain('<form');
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps library creation and making it the default as separate explicit actions', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'library' }) });
  vi.stubGlobal('fetch', fetch);
  const input = { parent:'E:\\', name:'Local AI Workstation Library', label:'Media' };
  await addStorageLibrary(input);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
  expect(fetch).toHaveBeenCalledTimes(1);
  await setDefaultStorageLibrary('library');
  expect(fetch.mock.calls[1][0]).toContain('/storage-libraries/default/library');
  expect(fetch.mock.calls[1][1].method).toBe('PUT');
});

it('reports unavailable libraries without selecting a replacement destination', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail:'Reconnect the original drive' }) });
  vi.stubGlobal('fetch', fetch);
  await expect(libraryExportFolder('images')).rejects.toThrow('Reconnect the original drive');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('only opens registered IDs and preserves native chooser cancellation', async () => {
  const open = vi.fn().mockResolvedValue({});
  vi.stubGlobal('window', { workstationDesktop: { chooseStorageLibraryParent: async () => ({ folder:null }), openStorageLibrary:open } });
  expect(await chooseStorageParent()).toBe('');
  await openStorageLibrary('library-id');
  expect(open).toHaveBeenCalledWith('library-id');
  vi.stubGlobal('window', {});
  await expect(chooseStorageParent()).rejects.toThrow('Paste a full drive');
});
