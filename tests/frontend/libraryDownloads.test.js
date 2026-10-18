import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { downloadImage } from '../../src/imageLibraryApi';

const { registerLibraryDownloadIpc } = createRequire(import.meta.url)('../../electron/libraryDownloads');
afterEach(() => vi.unstubAllGlobals());

it('only starts fixed library downloads for a trusted desktop and valid image ID', () => {
  const handlers = new Map(), downloadURL = vi.fn();
  registerLibraryDownloadIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedDesktop: event => event.trusted,
    getConnection: () => ({ base: 'http://127.0.0.1:8123', token: 'test-session-token' }),
  });
  const handle = handlers.get('image-library:download'), id = 'a'.repeat(32);
  const event = { trusted: true, sender: { downloadURL } };
  expect(handle({ ...event, trusted: false }, id)).toHaveProperty('error');
  for (const invalid of ['../private', 'https://example.com/file', id + '?token=x', null])
    expect(handle(event, invalid)).toHaveProperty('error');
  expect(downloadURL).not.toHaveBeenCalled();
  expect(handle(event, id)).toEqual({ started: true });
  expect(downloadURL).toHaveBeenCalledWith(`http://127.0.0.1:8123/image-library/images/${id}/content?download=true`,
    { headers: { 'X-LAW-Session': 'test-session-token' } });
});

it('checks image access before requesting a native download and reports failures', async () => {
  const native = vi.fn().mockResolvedValueOnce({ started: true }).mockResolvedValueOnce({ error: 'Download unavailable' });
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('window', { workstationDesktop: { downloadLibraryImage: native } });
  vi.stubGlobal('fetch', fetch);
  const image = { id: 'a'.repeat(32), url: '/image-library/images/' + 'a'.repeat(32) + '/content' };
  await downloadImage(image);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
  expect(native).toHaveBeenCalledWith(image.id);
  await expect(downloadImage(image)).rejects.toThrow('Download unavailable');
  fetch.mockResolvedValue({ ok: false });
  await expect(downloadImage(image)).rejects.toThrow('unavailable or locked');
  expect(native).toHaveBeenCalledTimes(2);
});
