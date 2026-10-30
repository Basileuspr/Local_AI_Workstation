import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadImage } from '../../src/imageLibraryApi';

const { registerLibraryDownloadIpc, createLibrarySaver } = createRequire(import.meta.url)('../../electron/libraryDownloads');
const roots = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true }); });
async function folder() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'law-save-test-')); roots.push(root); return root; }
const headersFor = bytes => ({ 'content-type': 'image/png', 'content-length': String(bytes.length), 'x-law-sha256': createHash('sha256').update(bytes).digest('hex'), 'content-disposition': "attachment; filename*=UTF-8''grid.png" });

it('streams a 70 MiB original to a verified file without reading an arrayBuffer', async () => {
  const root = await folder(), target = path.join(root, 'grid.png');
  const chunk = Buffer.alloc(1024 * 1024, 83), hash = createHash('sha256');
  for (let n = 0; n < 70; n++) hash.update(chunk);
  const headers = { ...headersFor(chunk), 'content-length': String(chunk.length * 70), 'x-law-sha256': hash.digest('hex') };
  let number = 0;
  const getResponse = vi.fn(async (_id, method) => method === 'HEAD' ? new Response(null, { headers }) : new Response(new ReadableStream({ pull(controller) { if (number++ < 70) controller.enqueue(chunk); else controller.close(); } }), { headers }));
  const save = createLibrarySaver({ getResponse, downloads: () => root, showDialog: async () => ({ filePath: target }) });
  const result = await save('a'.repeat(32));
  expect(result).toMatchObject({ saved: true, path: target, size: 70 * chunk.length });
  const file = await fs.open(target);
  try { const actual = createHash('sha256'); for await (const part of file.createReadStream()) actual.update(part); expect(actual.digest('hex')).toBe(headers['x-law-sha256']); } finally { await file.close(); }
  expect(await fs.readdir(root)).toEqual(['grid.png']);
});

it('preserves an existing destination and cleans partial files on a truncated transfer', async () => {
  const root = await folder(), target = path.join(root, 'grid.png');
  await fs.writeFile(target, 'previous copy');
  const headers = headersFor(Buffer.from('complete image'));
  const save = createLibrarySaver({ downloads: () => root, showDialog: async () => ({ filePath: target }), getResponse: async (_id, method) => new Response(method === 'HEAD' ? null : 'broken', { headers }) });
  await expect(save('a'.repeat(32))).rejects.toThrow('incomplete');
  expect(await fs.readFile(target, 'utf8')).toBe('previous copy');
  expect(await fs.readdir(root)).toEqual(['grid.png']);
});

it('does not transfer a body after canceling the save dialog', async () => {
  const root = await folder(), getResponse = vi.fn(async () => new Response(null, { headers: headersFor(Buffer.from('image')) }));
  const save = createLibrarySaver({ downloads: () => root, showDialog: async () => ({ canceled: true }), getResponse });
  expect(await save('a'.repeat(32))).toEqual({ canceled: true });
  expect(getResponse).toHaveBeenCalledTimes(1);
});

it('rejects untrusted callers, arbitrary paths and unknown saved-file receipts', async () => {
  const handlers = new Map(), fetchResponse = vi.fn();
  registerLibraryDownloadIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, trustedDesktop: event => event.trusted, getConnection: () => ({}), fetchResponse });
  const handle = handlers.get('image-library:download'), id = 'a'.repeat(32);
  expect(await handle({ trusted: false }, id)).toHaveProperty('error');
  for (const invalid of ['../private', 'https://example.com/file', id + '?token=x', null]) expect(await handle({ trusted: true }, invalid)).toHaveProperty('error');
  expect(fetchResponse).not.toHaveBeenCalled();
  expect(await handlers.get('image-library:saved-file')({ trusted: true }, 'C:/private.png', 'open')).toHaveProperty('error');
});

it('waits for confirmed native completion, handles cancellation, and surfaces save failures', async () => {
  const native = vi.fn().mockResolvedValueOnce({ saved: true, path: 'saved.png' }).mockResolvedValueOnce({ canceled: true }).mockResolvedValueOnce({ error: 'Disk full' });
  const fetch = vi.fn();
  vi.stubGlobal('window', { workstationDesktop: { downloadLibraryImage: native } }); vi.stubGlobal('fetch', fetch);
  const image = { id: 'a'.repeat(32), url: '/image-library/images/' + 'a'.repeat(32) + '/content' };
  expect(await downloadImage(image)).toMatchObject({ saved: true });
  expect(await downloadImage(image)).toEqual({ canceled: true });
  await expect(downloadImage(image)).rejects.toThrow('Disk full');
  expect(fetch).not.toHaveBeenCalled();
});
