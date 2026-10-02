import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import HashAuditor, { MatchGroup } from '../../src/components/HashAuditor';
import { folderPaths, formatAuditBytes, auditGroups, auditInventory, startAudit, cancelAudit,
  chooseAuditFolders, auditExportUrl, exportAudit } from '../../src/hashAuditor';

afterEach(() => vi.unstubAllGlobals());

it('accepts quoted folder and whole-drive selections without splitting spaces', () => {
  expect(folderPaths(' "C:\\My Folder"\r\nE:\\\nC:\\My Folder\n\n')).toEqual(['C:\\My Folder', 'E:\\']);
  expect(formatAuditBytes(0)).toBe('0 B');
  expect(formatAuditBytes(1024 ** 3)).toBe('1 GiB');
  expect(formatAuditBytes(null)).toBe('Unknown size');
});

it('starts only through the explicit action and keeps all supplied roots and excludes', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'job' }) });
  vi.stubGlobal('fetch', fetch);
  const markup = renderToStaticMarkup(<HashAuditor />);
  expect(fetch).not.toHaveBeenCalled();
  expect(markup).toContain('Start audit');
  expect(markup).toContain('Full inventory CSV');
  const roots = ['C:\\Chosen Folder', 'E:\\'];
  const excludes = ['E:\\Skip'];
  await startAudit(roots, excludes);
  expect(fetch.mock.calls[0][0]).toContain('/hash-auditor/scans');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ roots, excludes });
  await cancelAudit('job');
  expect(fetch.mock.calls[1][1].method).toBe('POST');
  expect(fetch.mock.calls[1][0]).toContain('/scans/job/cancel');
});

it('preserves literal search text and queries the selected match type', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
  vi.stubGlobal('fetch', fetch);
  await auditInventory('C:\\100%_done\\a & b', 100);
  const url = new URL(fetch.mock.calls[0][0]);
  expect(url.searchParams.get('search')).toBe('C:\\100%_done\\a & b');
  expect(url.searchParams.get('offset')).toBe('100');
  await auditGroups('name_size_modified', 20);
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('mode')).toBe('name_size_modified');
  const exportUrl = new URL(auditExportUrl('matches', 'name_size'));
  expect(exportUrl.searchParams.get('mode')).toBe('name_size');
  expect(exportUrl.searchParams.has('limit')).toBe(false);
});

it('reports validation and permission errors without claiming a scan started', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'Choose a directory' }) }));
  await expect(startAudit(['file.txt'], [])).rejects.toThrow('Choose a directory');
  vi.stubGlobal('window', {});
  await expect(chooseAuditFolders()).rejects.toThrow('Paste an absolute folder path');
  vi.stubGlobal('window', { workstationDesktop: { chooseHashAuditFolders: async () => ({ error: 'Folder dialog unavailable' }) } });
  await expect(chooseAuditFolders()).rejects.toThrow('Folder dialog unavailable');
});

it('handles cancelled and multiple native folder selections', async () => {
  vi.stubGlobal('window', { workstationDesktop: { chooseHashAuditFolders: vi.fn()
    .mockResolvedValueOnce({ paths: [], canceled: true }).mockResolvedValueOnce({ paths: ['C:\\Chosen', 'E:\\'] }) } });
  await expect(chooseAuditFolders()).resolves.toEqual([]);
  await expect(chooseAuditFolders()).resolves.toEqual(['C:\\Chosen', 'E:\\']);
});

it('streams desktop exports through the native bridge and reports export failures', async () => {
  const exportHashAudit = vi.fn().mockResolvedValueOnce({ started: true }).mockResolvedValueOnce({ error: 'Download unavailable' });
  vi.stubGlobal('window', { workstationDesktop: { exportHashAudit } });
  await exportAudit('matches', 'name_size');
  expect(exportHashAudit).toHaveBeenCalledWith('matches', 'name_size');
  await expect(exportAudit('inventory')).rejects.toThrow('Download unavailable');
  vi.stubGlobal('window', {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  await expect(exportAudit('inventory')).rejects.toThrow('Could not export the audit (503)');
});

it('distinguishes metadata candidates and hard links from independent content copies', () => {
  const group = { key: 'group', file_count: 3, physical_files: 2, values: { size: 4, sha256: 'a'.repeat(64) }, files: [
    { path: 'C:\\A\\same.txt', size: 4, sha256: 'a'.repeat(64), status: 'verified', links: 2 },
    { path: 'E:\\B\\same.txt', size: 4, sha256: 'b'.repeat(64), status: 'verified', links: 1 },
  ] };
  const exact = renderToStaticMarkup(<MatchGroup group={group} mode="hash" initiallyOpen />);
  expect(exact).toContain('a'.repeat(64));
  expect(exact).toContain('not independent copies');
  expect(exact).toContain('Show more paths (2 of 3)');
  const metadata = renderToStaticMarkup(<MatchGroup group={group} mode="name_size" />);
  expect(metadata).toContain('Metadata match only. Content may differ.');
  expect(metadata).toContain('b'.repeat(64));
  expect(metadata).toContain('C:\\A\\same.txt');
  expect(metadata).toContain('E:\\B\\same.txt');
});
