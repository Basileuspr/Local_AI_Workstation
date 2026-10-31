import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import ReverseEngineer from '../../src/components/ReverseEngineer';
import { filterReverseTools, loadReverseLinks, REVERSE_ENGINEER_KEY, saveReverseLinks, validateReverseLinks } from '../../src/reverseEngineer';
import { filterNavigationSections, normalizeNavigationOrder, orderedSections } from '../../src/navigationOrder';
import { functionTargets } from '../../src/functionButtons';
import { pinnableTabs } from '../../src/chatPins';

afterEach(() => vi.unstubAllGlobals());
const choice = { id: '12345678-1234-1234-1234-123456789abc', name: 'Ghidra.lnk' };
const memory = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }; };

describe('reverse-engineering launchers', () => {
  it('persists only known tool associations and opaque picker IDs, never arbitrary commands', () => {
    const storage = memory();
    expect(loadReverseLinks(storage)).toEqual({ links: {}, error: '' });
    saveReverseLinks({ ghidra: { ...choice, path: 'private location' } }, storage);
    expect(loadReverseLinks(storage)).toEqual({ links: { ghidra: choice }, error: '' });
    expect(storage.getItem(REVERSE_ENGINEER_KEY)).not.toContain('private location');
    for (const invalid of [[], null, { unknown: choice }, { ghidra: { id: 'cmd.exe /c example', name: 'Command' } }, { ghidra: { ...choice, name: '' } }]) {
      expect(() => validateReverseLinks(invalid)).toThrow();
    }
  });

  it('preserves damaged storage and surfaces unavailable storage without replacing saved links', () => {
    const storage = memory(); storage.setItem(REVERSE_ENGINEER_KEY, '{damaged');
    expect(loadReverseLinks(storage).error).toContain('preserved');
    expect(storage.getItem(REVERSE_ENGINEER_KEY)).toBe('{damaged');
    const blocked = { getItem() { throw Error('Storage blocked'); }, setItem() { throw Error('Storage full'); } };
    expect(loadReverseLinks(blocked).error).toBeTruthy();
    expect(() => saveReverseLinks({ ghidra: choice }, blocked)).toThrow('Storage full');
  });

  it('combines search, category and linked filters, including empty results', () => {
    expect(filterReverseTools('  WINDOWS debugger ', 'Runtime analysis').map(tool => tool.id)).toEqual(['x64dbg']);
    expect(filterReverseTools('', '.NET').map(tool => tool.id)).toEqual(['ilspy', 'dnspyex']);
    expect(filterReverseTools('', '', true, { ghidra: choice }).map(tool => tool.id)).toEqual(['ghidra']);
    expect(filterReverseTools('ghidra', 'Android')).toEqual([]);
    expect(filterReverseTools('', '', true, {})).toEqual([]);
  });

  it('keeps browser-only cards useful with native actions disabled and safe external links', () => {
    vi.stubGlobal('localStorage', memory());
    const { document } = parseHTML(renderToStaticMarkup(<ReverseEngineer />));
    expect([...document.querySelectorAll('article h2')].map(node => node.textContent)).toEqual([
      'Ghidra', 'IDA / IDA Pro', 'Binary Ninja', 'Cutter', 'radare2', 'x64dbg', 'ILSpy', 'dnSpyEx', 'JADX', 'Frida',
    ]);
    expect(document.querySelectorAll('button[disabled]')).toHaveLength(20);
    for (const link of document.querySelectorAll('a')) {
      expect(new URL(link.href).protocol).toBe('https:');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('adds a main-bar destination without replacing saved order and supports existing discovery/pinning', () => {
    const order = normalizeNavigationOrder({ tabs: { utilities: ['tools', 'dashboard'] } });
    expect(order.tabs.utilities.slice(0, 2)).toEqual(['tools', 'dashboard']);
    expect(order.tabs.utilities).toContain('reverse-engineer');
    expect(filterNavigationSections(orderedSections(order), 'Ghidra').flatMap(section => section.items.map(item => item.id))).toEqual(['reverse-engineer']);
    expect(pinnableTabs).toContain('reverse-engineer');
    expect(functionTargets.map(item => item.id)).toEqual(expect.arrayContaining(['reverse-engineer', 'capture:reverse-engineer']));
  });
});
