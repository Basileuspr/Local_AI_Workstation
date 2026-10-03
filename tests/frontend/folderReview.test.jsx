import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FolderReview, { FolderReviewFiles, FolderReviewProcessing } from '../../src/components/FolderReview';
import { folderReviewDefaults, folderReviewModels, folderReviewRequest, folderReviewResponse, folderReviewRunning } from '../../src/folderReview';
import { appTabs, appTabLabels } from '../../src/navigation';
import { functionTargets } from '../../src/functionButtons';
import SidebarNavigation from '../../src/components/SidebarNavigation';
import {WorkspaceHelpContent} from '../../src/components/WorkspaceInfo';

describe('Folder Review workspace', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('offers an explicit start, folder scope, batch limits and text-only PDF/image policy', () => {
    const html = renderToStaticMarkup(<FolderReview models={['local-model']} />);
    for (const label of ['Folder Review', 'Start Folder Review', 'Browse', 'Include subfolders', 'Characters per text batch', 'Inventory and text extraction only']) expect(html).toContain(label);
    expect(renderToStaticMarkup(<WorkspaceHelpContent tab="folder-review"/>)).toContain('Images contribute metadata, not pixels');
    expect(html).toContain('disabled');
    expect(folderReviewDefaults.batch_chars).toBe(4000);
  });
  it('makes the workspace and custom Functions shortcut discoverable', () => {
    expect(appTabs).toContain('folder-review');
    expect(appTabLabels['folder-review']).toBe('Folder Review');
    expect(functionTargets.some(item => item.id === 'folder-review')).toBe(true);
    expect(renderToStaticMarkup(<SidebarNavigation activeTab="folder-review" onSelect={() => {}}/>)).toContain('data-sidebar-route="folder-review"');
  });
  it('renders model output as inert text and displays coverage and metadata', () => {
    const html = renderToStaticMarkup(<FolderReviewFiles items={[{ ordinal: 1, path: 'photo.png', kind: 'image', status: 'metadata_only', analysis: '<img src="https://example.org/image">', metadata: { width: 100, height: 50 }, coverage: { reason: 'No pixels analyzed' } }]} />);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img ');
    expect(html).toContain('metadata only');
    expect(html).toContain('No pixels analyzed');
    expect(html).toContain('&quot;width&quot;: 100');
  });
  it('normalizes available model names and distinguishes active jobs from saved results', () => {
    expect(folderReviewModels(['model', { name: 'model' }, { name: 'second' }])).toEqual(['model', 'second']);
    expect(folderReviewModels([null, {}, { name: {} }, 'model'])).toEqual(['model']);
    expect(folderReviewRunning('cancelling')).toBe(true);
    expect(folderReviewRunning('interrupted')).toBe(false);
    expect(folderReviewRunning('completed_with_gaps')).toBe(false);
  });
  it('shows persisted processing counts and distinguishes verified release from deferred release', () => {
    const processing = { context_limit: 4096, text_batches_total: 20, text_batches_completed: 20, compactions: 4, offload_preparations: 25, model_released: true };
    const html = renderToStaticMarkup(<FolderReviewProcessing processing={processing}/>);
    for (const text of ['4,096 tokens', 'Text batches: 20/20', 'Compactions: 4', 'Memory preparation checks: 25', 'Review model released']) expect(html).toContain(text);
    const deferred = renderToStaticMarkup(<FolderReviewProcessing processing={{ ...processing, model_released: false, model_release_deferred: true, model_release_error: 'Provider unavailable' }}/>);
    expect(deferred).toContain('Model release deferred');
    expect(deferred).not.toContain('Review model released');
    expect(deferred).toContain('Model release could not be confirmed: Provider unavailable');
    expect(renderToStaticMarkup(<FolderReviewProcessing processing={{}}/>)).toBe('');
  });
  it('rejects malformed responses before replacing recoverable UI state', async () => {
    const review = { id: 'a'.repeat(32), status: 'interrupted', root: 'fixture', phase: 'Interrupted', started_at: 'date', total: 1, processed: 0, batch: 0, batches: 0 };
    expect(folderReviewResponse('/status', { active: null, reviews: [review] }).reviews).toEqual([review]);
    for (const data of [null, {}, { active: null, reviews: {} },
      { active: null, reviews: [{ ...review, processing: { context_limit: {} } }] },
      { active: null, reviews: [{ ...review, current_path: {} }] },
      { active: null, reviews: [{ ...review, processing: { model_released: 'false' } }] }]) {
      expect(() => folderReviewResponse('/status', data)).toThrow('invalid response');
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw Error('Bad JSON'); } }));
    await expect(folderReviewRequest('/reviews', { body: { root: 'fixture' } })).rejects.toThrow('Refresh results');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: 'Another review is running' }) }));
    await expect(folderReviewRequest('/reviews', { body: {} })).rejects.toThrow('Another review is running');
  });
  it('keeps caller cancellation and a request timeout on paginated requests', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], total: 0, offset: 0 }) });
    vi.stubGlobal('fetch', fetch);
    await folderReviewRequest('/reviews/' + 'a'.repeat(32) + '/files', { signal: controller.signal });
    const signal = fetch.mock.calls[0][1].signal;
    expect(signal).not.toBe(controller.signal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
  it('displays saved-state warnings and provider retries as inert text', () => {
    const html = renderToStaticMarkup(<FolderReviewFiles items={[{ ordinal: 1, path: 'fixture.txt', kind: 'text', status: 'not_reviewed', analysis: 'Saved batch finding.', metadata: {}, coverage: { partial: true, batches_total: 3, batches_completed: 1 }, data_warnings: ['Saved metadata could not be read.'] }]} />);
    expect(html).toContain('Saved metadata could not be read.');
    expect(html).toContain('1 of 3 text batches analyzed');
    expect(renderToStaticMarkup(<FolderReviewProcessing processing={{ context_limit: 4096, provider_retries: 1 }}/>)).toContain('Provider retries: 1');
  });
});
