import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigationSections, normalizeNavigationOrder, orderedSections, reorderIds, loadNavigationOrder, saveNavigationOrder, NAVIGATION_ORDER_KEY } from '../../src/navigationOrder';
import { appTabs } from '../../src/navigation';
import SidebarNavigation from '../../src/components/SidebarNavigation';
import { toggleImageSelection } from '../../src/imageManagerApi';
afterEach(() => vi.unstubAllGlobals());
describe('app-wide navigation priority', () => {
  it('covers every app tab exactly once, including all non-image workspaces', () => {
    const ids = navigationSections.flatMap(section => section.items.map(item => item.id));
    expect([...ids].sort()).toEqual([...appTabs].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('reorders sections and their tabs without changing canonical navigation or caller data', () => {
    const order = normalizeNavigationOrder(), prior = JSON.stringify(order);
    const reordered = { ...order, sections: reorderIds(order.sections, order.sections.indexOf('viewers'), 1), tabs: { ...order.tabs, workspace: reorderIds(order.tabs.workspace, 2, 0) } };
    const sections = orderedSections(reordered);
    expect(sections[0].id).toBe('utilities');
    expect(sections[1].id).toBe('viewers');
    expect(sections.find(section => section.id === 'workspace').items[0].id).toBe('knowledge');
    expect(JSON.stringify(order)).toBe(prior);
  });
  it('persists ordering, ignores stale/duplicate IDs, and appends newly available tabs', () => {
    const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    saveNavigationOrder({ sections: ['images', 'images', 'obsolete'], tabs: { workspace: ['audio', 'audio', 'deleted'] } }, storage);
    const restored = loadNavigationOrder(storage);
    expect(restored.sections[1]).toBe('images'); expect(restored.tabs.workspace[0]).toBe('audio');
    expect(restored.tabs.workspace).toContain('folder-review');
    expect(restored.tabs.workspace.filter(id => id === 'audio')).toHaveLength(1);
    values.set(NAVIGATION_ORDER_KEY, 'broken JSON'); expect(loadNavigationOrder(storage)).toEqual(normalizeNavigationOrder());
    expect(() => saveNavigationOrder({}, { setItem() { throw Error('Unavailable'); } })).toThrow();
  });
  it('renders the saved priority in the shared navigation for every workspace', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ sections: ['viewers', 'images'], tabs: { viewers: ['spreadsheets', 'shortcuts'], images: ['image-manager', 'images'] } }) });
    const markup = renderToStaticMarkup(<SidebarNavigation activeTab="spreadsheets" onSelect={() => {}} />);
    expect(markup.indexOf('data-sidebar-route="spreadsheets"')).toBeLessThan(markup.indexOf('data-sidebar-route="shortcuts"'));
    expect(markup.indexOf('data-sidebar-route="shortcuts"')).toBeLessThan(markup.indexOf('data-sidebar-route="image-manager"'));
    expect(markup).toContain('Arrange tabs');
    expect(markup).toContain('aria-current="page"');
  });
  it('consolidates Web routes once and migrates old arrangements without reordering existing groups', () => {
    const legacy = { sections: ['images', 'workspace', 'viewers', 'characters', 'learning'],
      tabs: { workspace: ['reels-analyzer', 'audio', 'web-system', 'chats'], viewers: ['browser', 'spreadsheets'] } };
    const order = normalizeNavigationOrder(legacy);
    expect(order.sections).toEqual(['utilities', 'images', 'workspace', 'web', 'viewers', 'characters', 'learning', 'design-code']);
    expect(order.tabs.web).toEqual(['browser', 'web-system', 'reels-analyzer']);
    expect(order.tabs.workspace.slice(0, 2)).toEqual(['audio', 'chats']);
    expect(order.tabs.viewers[0]).toBe('spreadsheets');
    expect(normalizeNavigationOrder({ ...order, sections: ['web', 'viewers', 'images'] }).sections.slice(0, 4)).toEqual(['utilities', 'web', 'viewers', 'images']);
    const sections = orderedSections(order);
    expect(sections.flatMap(section => section.items).filter(item => ['browser', 'web-system', 'reels-analyzer'].includes(item.id))).toHaveLength(3);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) });
    for (const tab of order.tabs.web) {
      const markup = renderToStaticMarkup(<SidebarNavigation activeTab={tab} onSelect={() => {}} />);
      expect(markup).toContain('aria-controls="sidebar-group-web"');
      expect(markup).toContain('id="sidebar-group-web" class="sidebar-group-items"');
      expect(markup).not.toContain('id="sidebar-group-web" class="sidebar-group-items" hidden');
    }
  });
  it('moves Functions into the fixed utility header while retaining older saved tab priorities', () => {
    const order = normalizeNavigationOrder({ sections: ['viewers', 'functions', 'utilities'], tabs: { utilities: ['queue', 'dashboard', 'info-center'], functions: ['tools'] } });
    const sections = orderedSections(order);
    expect(sections[0].id).toBe('utilities');
    expect(sections[0].items.map(item => item.id)).toEqual(['queue', 'dashboard', 'info-center', 'tools', 'design-programming']);
    expect(order.sections).not.toContain('functions');
    expect(sections.flatMap(section => section.items).filter(item => item.id === 'tools')).toHaveLength(1);
    vi.stubGlobal('localStorage', { getItem: key => key === NAVIGATION_ORDER_KEY ? JSON.stringify(order) : null });
    const markup = renderToStaticMarkup(<SidebarNavigation activeTab="tools" onSelect={() => {}} />);
    expect(markup.indexOf('data-sidebar-route="tools"')).toBeLessThan(markup.indexOf('id="sidebar-tab-sections"'));
    expect(markup).toContain('Expand tab pane');
    expect(markup).toContain('Resize tab pane and collections');
  });
});
describe('image click selection', () => {
  it('toggles the same image off, adds once, preserves other selections and caps transfers', () => {
    const prior = ['first'];
    expect(toggleImageSelection(prior, 'second')).toEqual(['first', 'second']);
    expect(toggleImageSelection(['first', 'second'], 'second')).toEqual(['first']);
    expect(prior).toEqual(['first']);
    expect(toggleImageSelection(Array.from({ length: 1000 }, (_, i) => String(i)), 'extra')).toHaveLength(1000);
  });
});
