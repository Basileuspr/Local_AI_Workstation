import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SidebarNavigation from '../../src/components/SidebarNavigation';
import { appTabs, appTabLabels } from '../../src/navigation';
import { functionTargets, captureActions } from '../../src/functionButtons';
import { confirmationFor, originalImage, imageSteps, imageUrl, updateImageFilters, imageVisibility } from '../../src/imageManagerApi';
import { ImageManagerFilters } from '../../src/components/ImageManager';
import { localImageUrl } from '../../src/chatImages';
import { API_BASE } from '../../src/api';
const require = createRequire(import.meta.url);
const { TAB_LABELS } = require('../../electron/tabCapture');
afterEach(() => vi.unstubAllGlobals());
describe('separate image manager integration', () => {
  it('places Image Manager beside Gallery inside Images and retains the motion manager', () => {
    const markup = renderToStaticMarkup(<SidebarNavigation activeTab="image-manager" onSelect={() => {}} />);
    expect(markup.indexOf('data-sidebar-route="images"')).toBeLessThan(markup.indexOf('data-sidebar-route="image-manager"'));
    expect(markup.indexOf('data-sidebar-route="image-manager"')).toBeLessThan(markup.indexOf('data-sidebar-route="generate"'));
    expect(markup).toContain('data-media-manager-tab=""');
    expect(appTabs).toContain('image-manager');
    expect(appTabLabels['image-manager']).toBe('Image Manager');
    expect(TAB_LABELS['image-manager']).toBe('Image Manager');
    expect(functionTargets.some(target => target.id === 'image-manager')).toBe(true);
    expect(captureActions.some(target => target.id === 'capture:image-manager')).toBe(true);
  });
  it('allows only catalog image-file URLs into explicit editor/gallery/chat handoffs', () => {
    const image = originalImage({ id: 'a'.repeat(32), relative: 'holiday/photo.png' });
    expect(image.name).toBe('photo.png'); expect(localImageUrl(image.url)).toBeTruthy();
    expect(localImageUrl(`${API_BASE}/image-manager/images/${'a'.repeat(32)}/location`)).toBeNull();
    expect(localImageUrl(`${API_BASE}/image-manager/images/unknown/file`)).toBeNull();
    expect(localImageUrl(`https://example.com/image-manager/images/${'a'.repeat(32)}/file`)).toBeNull();
  });
  it('makes organization confirmation specific to action and count, and functions cannot apply it', () => {
    expect(confirmationFor({ mode: 'move', entries: [{}, {}] })).toBe('MOVE 2');
    expect(confirmationFor({ mode: 'copy', entries: [{}] })).toBe('COPY 1');
    expect(Object.keys(imageSteps)).toEqual(['scan', 'duplicates', 'plan', 'duplicate-plan', 'report']);
  });
  it('refreshes thumbnail URLs after a rescan records changed source metadata', () => {
    const image = { id: 'a'.repeat(32), signature: [100, 1000, 1, 2] };
    expect(imageUrl(image)).not.toBe(imageUrl({ ...image, signature: [100, 1001, 1, 2] }));
    expect(new URL(imageUrl(image, true)).searchParams.get('large')).toBe('true');
  });
  it('offers exact saved tag choices without adding a row of tag buttons; keeps extra filters collapsed', () => {
    const filters = { search: '', folder_id: '', tag: 'Client & 50%', format: 'PNG', month: '', favorite: true, hide_tagged: false, sort: 'date' };
    const props = { filters, page: { formats: ['PNG'], months: [], tags: ['Client & 50%', '<script>'] }, folders: [], view: 'library', onFilter() {}, onReset() {} };
    const markup = renderToStaticMarkup(<ImageManagerFilters {...props}/>);
    expect(markup).toContain('aria-label="Filter image tag"');
    expect(markup).toContain('<option value="Client &amp; 50%" selected="">Client &amp; 50%</option>');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('More filters · PNG · Favorites');
    expect(markup).toContain('<details class="im-extra-filters">');
    const absent = renderToStaticMarkup(<ImageManagerFilters {...props} page={{ ...props.page, tags: [] }}/>);
    expect(absent).toContain('Client &amp; 50% (no matches)');
  });
  it('selecting a tag clears untagged-only, and choosing untagged-only clears the tag', () => {
    const filters = { tag: '', hide_tagged: true, tagged_only: false, search: 'photo', folder_id: 'source' };
    const tagged = updateImageFilters(filters, 'tag', 'Done');
    expect(tagged).toEqual({ ...filters, tag: 'Done', hide_tagged: false });
    expect(updateImageFilters(tagged, 'hide_tagged', true)).toEqual(filters);
    expect(updateImageFilters(tagged, 'sort', 'name')).toEqual({ ...tagged, sort: 'name' });
  });
  it('shows tagged images including hidden ones and keeps tagged and untagged filters mutually exclusive', () => {
    const filters = { tag: 'Trip', hide_tagged: true, tagged_only: false, search: 'photo', folder_id: 'source' };
    const tagged = updateImageFilters(filters, 'tagged_only', true);
    expect(tagged).toEqual({ ...filters, hide_tagged: false, tagged_only: true });
    expect(imageVisibility(tagged, 'library')).toBe('all');
    expect(imageVisibility(tagged, 'hidden')).toBe('hidden');
    expect(imageVisibility(updateImageFilters(tagged, 'tagged_only', false), 'library')).toBe('visible');
    expect(updateImageFilters(tagged, 'hide_tagged', true)).toEqual({ ...filters, tag: '' });
  });
});
