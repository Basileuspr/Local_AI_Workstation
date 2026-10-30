import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { accentColors, appearanceColors, appearanceThemes, appearanceVariables, applyAppearance, defaultAppearance, normalizeAppearance } from '../../src/appearance';
import { DESIGN_DRAFT_KEY, designCSS, designDocument, designExampleCSS, designTemplates, loadDesign, loadDesignPresets, normalizeDesign, parseDesign, serializeDesign } from '../../src/designPlayground';
import { DESIGN_TAB, designTools } from '../../src/designWorkspace';
import { stylingExamples } from '../../src/stylingLibrary';
import { normalizeNavigationOrder, orderedSections, filterNavigationSections } from '../../src/navigationOrder';
import SidebarNavigation from '../../src/components/SidebarNavigation';
import DesignWorkspace from '../../src/components/DesignWorkspace';
import { reducer } from '../../src/useStore';
import { loadPreferences, pickPreferences, savePreferences } from '../../src/preferences';

afterEach(() => vi.unstubAllGlobals());
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; };

describe('Design & Programming navigation', () => {
  it('promotes a main workspace and moves every source viewer without dropping old priorities', () => {
    const old = { tabs: { viewers: ['spreadsheets', 'js-viewer', 'markdown', 'css-viewer'] } };
    const order = normalizeNavigationOrder(old), sections = orderedSections(order);
    expect(order.tabs.viewers).toEqual(['spreadsheets', '3d-viewer', 'shortcuts']);
    expect(order.tabs['design-code'].slice(0, 3)).toEqual(['js-viewer', 'markdown', 'css-viewer']);
    expect(sections[0].items.some(item => item.id === DESIGN_TAB)).toBe(true);
    expect(filterNavigationSections(sections, 'javascript').flatMap(section => section.items.map(item => item.id))).toEqual(['js-viewer']);
    for (const tool of designTools) {
      const { document } = parseHTML(renderToStaticMarkup(<SidebarNavigation activeTab={tool.id} onSelect={() => {}} />));
      expect(document.querySelector(`[data-sidebar-route="${DESIGN_TAB}"]`).getAttribute('aria-current')).toBe('page');
      expect(document.querySelector(`[data-sidebar-route="${tool.id}"]`)).toBeNull();
      const workspace = parseHTML(renderToStaticMarkup(<DesignWorkspace tab={tool.id} onNavigate={() => {}}><p>Source draft</p></DesignWorkspace>)).document;
      expect(workspace.querySelector(`[data-design-route="${tool.id}"]`).getAttribute('aria-current')).toBe('page');
      expect(workspace.querySelectorAll('[data-design-route]')).toHaveLength(6);
    }
  });
});

describe('playground designs', () => {
  it('loads older/invalid drafts safely and retains each independent appearance choice', () => {
    const store = storage();
    expect(loadDesign({ theme: 'paper' }, store).appearance.theme).toBe('paper');
    store.setItem(DESIGN_DRAFT_KEY, '{broken');
    expect(loadDesign(defaultAppearance, store)).toEqual(normalizeDesign());
    const draft = normalizeDesign({ appearance: { ...designTemplates[0].appearance, font: 'georgia', contrast: 125 }, pieces: ['glass-card', 'bad', 'glass-card', 'loading-spinner'], layout: 'chat', width: 'phone' });
    expect(draft.pieces).toEqual(['glass-card', 'loading-spinner']);
    expect(draft.appearance).toMatchObject({ theme: 'slate', accent: 'violet', corners: 'soft', font: 'georgia', contrast: 125 });
    store.setItem(DESIGN_DRAFT_KEY, JSON.stringify(draft));
    expect(loadDesign(defaultAppearance, store)).toEqual(draft);
    expect(normalizeDesign({ appearance: { accent: 'url(https://bad)', corners: '__proto__', density: '999' }, layout: 'constructor', width: '__proto__' })).toMatchObject({ appearance: defaultAppearance, layout: 'studio', width: 'fluid' });
    expect(loadDesignPresets({ getItem: () => '{broken' })).toEqual([]);
    expect(loadDesignPresets({ getItem: () => JSON.stringify([{ name: '  Saved  ', design: draft }, { name: 4 }]) })).toEqual([{ name: 'Saved', design: draft }]);
  });
  it('round trips exported designs and rejects foreign or oversized files without executing them', () => {
    const draft = normalizeDesign({ appearance: designTemplates[1].appearance, layout: 'dashboard', pieces: stylingExamples.map(item => item.id) });
    expect(parseDesign(serializeDesign(draft))).toEqual(draft);
    for (const text of ['[]', '{"version":99}', '{broken', 'x'.repeat(100001)]) expect(() => parseDesign(text)).toThrow();
    const imported = parseDesign(JSON.stringify({ format: 'local-ai-workstation-design', version: 1, design: { appearance: { font: '</style><script>bad()</script>' }, pieces: ['<script>'] } }));
    expect(imported.appearance).toEqual(defaultAppearance);
    expect(imported.pieces).toEqual([]);
  });
  it('keeps appearance application in preferences, without saving preview layouts as app settings', () => {
    const store = storage(); vi.stubGlobal('localStorage', store); vi.stubGlobal('window', { localStorage: store });
    const draft = normalizeDesign({ appearance: designTemplates[1].appearance });
    const state = { appearance: defaultAppearance, selectedModel: 'keep-model', conversationHistory: ['keep'] };
    const applied = reducer(state, { type: 'SET_APPEARANCE', payload: draft.appearance });
    savePreferences(pickPreferences(applied));
    expect(loadPreferences().appearance).toEqual(draft.appearance);
    expect(applied.selectedModel).toBe(state.selectedModel);
    expect(applied.conversationHistory).toBe(state.conversationHistory);
    expect(applied).not.toHaveProperty('layout');
    expect(reducer(applied, { type: 'SET_APPEARANCE', payload: state.appearance }).appearance).toEqual(defaultAppearance);
    const root = { dataset: {}, style: { setProperty: vi.fn() } };
    applyAppearance(draft.appearance, root);
    expect(root.dataset).toMatchObject({ uiCorners: 'sharp', uiDensity: 'compact', uiButtons: 'outline' });
  });
  it('exports isolated offline samples and all 20 library components with the chosen style', () => {
    for (const template of designTemplates) {
      const draft = normalizeDesign({ appearance: template.appearance });
      const { document } = parseHTML(designDocument(draft));
      expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toContain("default-src 'none'");
      expect(document.querySelector('meta[name=viewport]')).not.toBeNull();
      expect(document.querySelector('script, link, [src]')).toBeNull();
      expect(document.querySelector('style').textContent).toContain('--ui-radius');
      for (const example of stylingExamples) {
        const css = designExampleCSS(example, draft);
        expect(css).toContain(example.css);
        expect(css).toContain('--surface: var(--bg-card)');
        expect(css).toContain('prefers-reduced-motion: reduce');
      }
    }
    expect(designCSS({ appearance: { motion: 'reduced' } })).toContain('* { animation: none !important');
  });
  it('selects light/dark accent variants and leaves all palette and font choices independent', () => {
    for (const theme of Object.keys(appearanceThemes)) for (const accent of Object.keys(accentColors)) {
      const settings = normalizeAppearance({ theme, accent, corners: 'soft', density: 'compact' });
      const colors = appearanceColors(settings), vars = appearanceVariables(settings);
      expect(colors['bg-primary']).toBe(appearanceThemes[theme].colors['bg-primary']);
      expect(colors.accent).toBe(accent === 'theme' ? appearanceThemes[theme].colors.accent : accentColors[accent][appearanceThemes[theme].scheme]);
      expect(vars['--ui-radius']).toBe('18px');
      expect(vars['--ui-control-y']).toBe('5px');
    }
  });
});
