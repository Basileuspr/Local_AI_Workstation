import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveActiveTab, appTabs } from '../../src/navigation';
import { orderedSections, filterNavigationSections } from '../../src/navigationOrder';
import { isDesignTab } from '../../src/designWorkspace';
import { validChatPin, validWorkspacePin } from '../../src/chatPins';
import { functionTargets, loadFunctionButtons } from '../../src/functionButtons';
import { loadCoordinatorDraft, saveCoordinatorDraft, sourceUrl } from '../../src/coordinator';
import { ResearchResult, MediaResult } from '../../src/components/CoordinatorHarness';

afterEach(() => vi.unstubAllGlobals());
it('promotes Coordinator while keeping legacy routes and pins usable', () => {
  expect(orderedSections()[0].items.some(item => item.id === 'coordinator')).toBe(true);
  expect(resolveActiveTab('coding-coordinator')).toBe('coordinator');
  expect(appTabs).toContain('coordinator');
  expect(isDesignTab('coding-coordinator')).toBe(false);
  expect(filterNavigationSections(orderedSections(), 'Media Librarian')[0].items[0].id).toBe('coordinator');
  expect(validChatPin({ kind: 'tool', tab: 'coding-coordinator' }).tab).toBe('coordinator');
  expect(validWorkspacePin('coordinator', { kind: 'tool', tab: 'coding-coordinator' })).toBeNull();
  expect(functionTargets.some(item => item.id === 'capture:coordinator')).toBe(true);
});

it('keeps drafts separate and tolerates unavailable or malformed storage', () => {
  const values = new Map(); vi.stubGlobal('localStorage', { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  saveCoordinatorDraft('research', { goal: 'Research draft' }); saveCoordinatorDraft('media', { goal: 'Media draft' });
  expect(loadCoordinatorDraft('research', { goal: '' }).goal).toBe('Research draft');
  expect(loadCoordinatorDraft('media', { goal: '' }).goal).toBe('Media draft');
  values.set('law-coordinator-media-v1', JSON.stringify({ goal: [], mediaIds: 'bad' }));
  expect(loadCoordinatorDraft('media', { goal: '', mediaIds: [] })).toEqual({ goal: '', mediaIds: [] });
  values.set('local-ai-workstation-function-buttons-v1', JSON.stringify([{ id: 'old', name: 'Old Coding', target: 'coding-coordinator' }]));
  expect(loadFunctionButtons()[0].target).toBe('coding-coordinator');
});

it('renders cited results safely and offers explicit Knowledge saves', () => {
  const html = renderToStaticMarkup(<ResearchResult run={{ id: 'run', receipts: [], result: { answer: [{ text: '<script>bad()</script>', citations: ['S1'] }], sources: [{ id: 'S1', title: 'Evidence', url: 'https://example.org', retrieved_at: 123 }] } }} busy={false} onSave={() => {}}/>);
  expect(html).toContain('Save S1 to Knowledge');
  expect(html).toContain('#coordinator-run-S1');
  expect(html).not.toContain('<script>');
  expect(sourceUrl('javascript:alert(1)')).toBeUndefined();
  expect(sourceUrl('https://user:secret@example.org')).toBeUndefined();
});

it('labels metadata proposals and disables already-applied proposals', () => {
  const html = renderToStaticMarkup(<MediaResult run={{ receipts: [{ action: 'metadata', media_id: 'library:a' }], result: { summary: 'Proposed', coverage: 'Metadata only', proposals: [{ media_id: 'library:a', tags: ['tag'], category: 'Reference', reason: 'Name' }], duplicate_groups: [] } }} busy={false} chosen={[]} onChosen={() => {}} onApply={() => {}}/>);
  expect(html).toContain('Applied'); expect(html).toContain('disabled'); expect(html).toContain('not a full-library duplicate scan');
});
