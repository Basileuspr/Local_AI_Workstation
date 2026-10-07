import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import StylingLibrary from '../../src/components/StylingLibrary';
import { filterStylingExamples, stylingExamples, stylingExampleDocument } from '../../src/stylingLibrary';
import { appTabs, appTabLabels, resolveActiveTab } from '../../src/navigation';
import { filterNavigationSections, orderedSections } from '../../src/navigationOrder';
import { functionTargets } from '../../src/functionButtons';
import { validChatPin } from '../../src/chatPins';

describe('Styling Library', () => {
  it('finds examples by multiple words and limits results to the chosen category', () => {
    const ids = options => filterStylingExamples(options).map(example => example.id);
    expect(ids({ query: '  SPINNER keyframes ', category: 'Animations' })).toEqual(['loading-spinner']);
    expect(ids({ query: 'text focus', category: 'Forms' })).toEqual(['labeled-input']);
    expect(ids({ query: 'spinner', category: 'Buttons' })).toEqual([]);
    expect(ids({ query: 'no-such-example' })).toEqual([]);
  });

  it('exports complete offline examples with their markup, styles and responsive metadata', () => {
    for (const example of stylingExamples) {
      const { document } = parseHTML(stylingExampleDocument(example));
      expect(document.documentElement.lang, example.id).toBe('en');
      expect(document.querySelector('meta[name=viewport]').content).toContain('width=device-width');
      expect(document.querySelector('title').textContent).toBe(example.title);
      expect(document.body.children.length, example.id).toBeGreaterThan(0);
      expect(document.querySelector('style').textContent).toContain(example.css);
      expect(document.querySelector('style').textContent).toContain('prefers-reduced-motion: reduce');
      expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toContain("default-src 'none'");
      expect(document.querySelector('script, link, [src], [href^="http"]'), example.id).toBeNull();
    }
  });

  it('applies the preview palette and pauses animation only when requested', () => {
    const example = stylingExamples.find(item => item.id === 'loading-spinner');
    expect(stylingExampleDocument(example, { theme: 'light', motion: false })).toContain('color-scheme: light');
    expect(stylingExampleDocument(example, { motion: false })).toContain('animation-play-state: paused');
    expect(stylingExampleDocument(example)).not.toContain('animation-play-state: paused');
  });

  it('renders isolated live previews and avoids creating them for a hidden workspace', () => {
    const { document } = parseHTML(renderToStaticMarkup(<StylingLibrary />));
    const previews = [...document.querySelectorAll('iframe')];
    expect(previews.length).toBe(stylingExamples.length);
    for (const preview of previews) {
      expect(preview.getAttribute('sandbox')).toBe('');
      expect(preview.getAttribute('referrerPolicy')).toBe('no-referrer');
      expect(preview.getAttribute('srcDoc')).toContain("default-src 'none'");
    }
    expect(renderToStaticMarkup(<StylingLibrary active={false} />)).not.toContain('<iframe');
  });

  it('supports navigation search, custom launch buttons and chat pinning', () => {
    expect(appTabs).toContain('styling-library');
    expect(appTabLabels['styling-library']).toBe('Styling Library');
    expect(resolveActiveTab('styling-library')).toBe('styling-library');
    expect(filterNavigationSections(orderedSections(), 'html animations').flatMap(section => section.items.map(item => item.id))).toEqual(['styling-library']);
    expect(functionTargets.some(target => target.id === 'styling-library')).toBe(true);
    expect(functionTargets.some(target => target.id === 'capture:styling-library')).toBe(true);
    expect(validChatPin({ kind: 'tool', tab: 'styling-library' })).toEqual({ kind: 'tool', tab: 'styling-library' });
  });
});
