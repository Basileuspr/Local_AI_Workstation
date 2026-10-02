import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FolderReview, { FolderReviewFiles } from '../../src/components/FolderReview';
import { folderReviewDefaults, folderReviewModels, folderReviewRunning } from '../../src/folderReview';
import { appTabs, appTabLabels } from '../../src/navigation';
import { functionTargets } from '../../src/functionButtons';
import SidebarNavigation from '../../src/components/SidebarNavigation';
import {WorkspaceHelpContent} from '../../src/components/WorkspaceInfo';

describe('Folder Review workspace', () => {
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
    expect(folderReviewRunning('cancelling')).toBe(true);
    expect(folderReviewRunning('interrupted')).toBe(false);
    expect(folderReviewRunning('completed_with_gaps')).toBe(false);
  });
});
