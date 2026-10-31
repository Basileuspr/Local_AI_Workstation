import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import PhoneWorkspace from '../../desktop/PhoneWorkspace';
import { filterNavigationSections, normalizeNavigationOrder, orderedSections } from '../../../src/navigationOrder';
import { functionTargets } from '../../../src/functionButtons';
import { pinnableTabs } from '../../../src/chatPins';

describe('Phone workspace availability', () => {
  it('offers honest installation status, official setup links and existing Companion in a browser', () => {
    const { document } = parseHTML(renderToStaticMarkup(<PhoneWorkspace />));
    expect(document.querySelectorAll('[data-phone-tool]')).toHaveLength(2);
    expect([...document.querySelectorAll('.phone-badge')].map(item => item.textContent)).toEqual(['Not checked', 'Not checked']);
    expect(document.querySelectorAll('.phone-actions button[disabled]')).toHaveLength(2);
    expect(document.textContent || document.documentElement.textContent).toContain('Phone connection and runtime compatibility have not been checked');
    expect(document.querySelector('.phone-companion[hidden] .mobile-control')).toBeTruthy();
    expect(document.querySelectorAll('[aria-label="Phone sections"] button')).toHaveLength(6);
    expect([...document.querySelectorAll('a')].map(item => item.href)).toEqual([
      'https://kdeconnect.kde.org/download.html', 'https://github.com/Genymobile/scrcpy/blob/master/doc/windows.md',
    ]);
  });
  it('can be searched, pinned and opened by Functions without disturbing saved navigation order', () => {
    const order = normalizeNavigationOrder({ tabs: { workspace: ['integrations', 'chats'] } });
    expect(order.tabs.workspace.slice(0, 2)).toEqual(['integrations', 'chats']);
    expect(order.tabs.workspace).toContain('phone');
    expect(filterNavigationSections(orderedSections(order), 'KDE scrcpy').flatMap(section => section.items.map(item => item.id))).toEqual(['phone']);
    expect(functionTargets.some(item => item.id === 'phone')).toBe(true);
    expect(pinnableTabs).toContain('phone');
  });
});
