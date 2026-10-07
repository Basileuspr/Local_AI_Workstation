import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import Tools from '../../src/components/Tools';
import { StoreProvider } from '../../src/useStore';
import { utilityActions } from '../../src/functionButtons';

afterEach(() => vi.unstubAllGlobals());
it('renders utility launchers above the builder without opening any program', () => {
  const openWindowsUtility = vi.fn(), chooseWindowsUtility = vi.fn();
  vi.stubGlobal('window', { workstationDesktop: { openWindowsUtility, chooseWindowsUtility } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const { document } = parseHTML(renderToStaticMarkup(<StoreProvider><Tools /></StoreProvider>));
  const section = document.querySelector('.functions-utilities');
  expect([...section.querySelectorAll('.function-launcher strong')].map(node => node.textContent)).toEqual(utilityActions.map(item => item.name));
  expect(section.querySelectorAll('[aria-label^="Choose program for"]')).toHaveLength(2);
  expect(section.querySelector('input').value).toBe('Computer\\HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders');
  expect(section.nextElementSibling.classList.contains('function-sequences')).toBe(true);
  expect(openWindowsUtility).not.toHaveBeenCalled(); expect(chooseWindowsUtility).not.toHaveBeenCalled();
});
