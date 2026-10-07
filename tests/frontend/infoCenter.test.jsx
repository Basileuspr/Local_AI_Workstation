import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import InfoCenter from '../../src/components/InfoCenter';
import { featureDirectory, featureUseCases, filterFeatures } from '../../src/featureUseCases';
import { appTabs, resolveActiveTab } from '../../src/navigation';
import { filterNavigationSections, orderedSections, normalizeNavigationOrder } from '../../src/navigationOrder';
import { functionTargets } from '../../src/functionButtons';

describe('Info Center', () => {
  it('covers every workspace once with practical use cases and shared guides', () => {
    const expected = appTabs.filter(tab => tab !== 'info-center').sort();
    expect(featureDirectory.map(feature => feature.id).sort()).toEqual(expected);
    expect(Object.keys(featureUseCases).sort()).toEqual(expected);
    for (const feature of featureDirectory) {
      expect(feature.useCases.length, feature.id).toBeGreaterThanOrEqual(2);
      expect(feature.example.length, feature.id).toBeGreaterThan(35);
      expect(feature.sections.length, feature.id).toBeGreaterThan(0);
    }
  });

  it('finds tasks and individual controls, combines words, and respects categories', () => {
    const ids = (query, category) => filterFeatures(query, category).map(feature => feature.id);
    expect(ids('  EXACT duplicates  ')).toEqual(expect.arrayContaining(['hash-auditor', 'image-manager']));
    expect(ids('citations')).toContain('document-editor');
    expect(ids('Top P', 'workspace')).toContain('chats');
    expect(ids('duplicates', 'images')).toContain('image-manager');
    expect(ids('duplicates', 'images')).not.toContain('hash-auditor');
    expect(ids('no-such-feature-xyz')).toEqual([]);
    expect(filterFeatures('  ')).toHaveLength(featureDirectory.length);
  });

  it('shows examples and labeled workspace actions without mounting all detailed guides', () => {
    const { document } = parseHTML(renderToStaticMarkup(<InfoCenter onOpenWorkspace={() => {}} />));
    expect(document.querySelectorAll('article')).toHaveLength(featureDirectory.length);
    expect(document.querySelector('[role="status"]').textContent).toContain(`${featureDirectory.length} of ${featureDirectory.length}`);
    for (const feature of featureDirectory) {
      expect(document.querySelector(`[aria-label="Open ${feature.title}"]`)).not.toBeNull();
      expect(document.getElementById(`info-guide-${feature.id}`).hasAttribute('hidden')).toBe(true);
    }
    expect(document.querySelectorAll('.workspace-info-content')).toHaveLength(0);
  });

  it('is discoverable and appends safely to saved navigation arrangements', () => {
    expect(resolveActiveTab('info-center')).toBe('info-center');
    expect(filterNavigationSections(orderedSections(), 'use cases').flatMap(group => group.items.map(item => item.id))).toEqual(['info-center']);
    expect(normalizeNavigationOrder({ tabs: { utilities: ['queue', 'dashboard'] } }).tabs.utilities).toEqual(['queue', 'dashboard', 'info-center']);
    expect(functionTargets.some(item => item.id === 'info-center')).toBe(true);
    expect(functionTargets.some(item => item.id === 'capture:info-center')).toBe(true);
  });
});
