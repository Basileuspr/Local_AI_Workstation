import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GitHubPublisher from '../../src/components/GitHubPublisher';

let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.unstubAllGlobals(); });
async function mount(desktop) {
  const dom = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.workstationDesktop = desktop;
  root = createRoot(document.querySelector('main'));
  await act(async () => root.render(<GitHubPublisher />));
}
const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name);

describe('Dashboard pull controls', () => {
  it('requires an explicit click, prevents repeat clicks, and shows completion outside collapsed details', async () => {
    let finish;
    const job = { status: 'idle' };
    const desktop = { githubPublicationState: async () => job,
      pullGitHubUpdates: vi.fn(() => new Promise(resolve => { finish = () => {
        job.pull = { status: 'completed', changed: true, after: 'a'.repeat(40), output: 'Fast-forward', ahead: 0 }; resolve({});
      }; })), prepareGitHubPublication: vi.fn() };
    await mount(desktop);
    expect(desktop.pullGitHubUpdates).not.toHaveBeenCalled();
    expect(document.querySelector('#github-publication-details').hidden).toBe(true);
    expect(button('Pull from GitHub').closest('[hidden]')).toBeNull();
    expect(document.querySelector('code').textContent).toBe('git pull --ff-only origin main');
    await act(async () => button('Pull from GitHub').click());
    expect(button('Pull from GitHub').disabled).toBe(true);
    expect(button('Review source changes').disabled).toBe(true);
    await act(async () => button('Pull from GitHub').click());
    expect(desktop.pullGitHubUpdates).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(document.body.textContent).toContain('Updated source to aaaaaaa');
    expect(document.body.textContent).toContain('npm run build');
    expect(document.querySelector('pre').textContent).toBe('Fast-forward');
    expect(button('Pull from GitHub').disabled).toBe(false);
  });

  it('shows failures and disables the button without the desktop bridge', async () => {
    await mount({ githubPublicationState: async () => ({ status: 'idle' }), pullGitHubUpdates: async () => ({ error: 'Local changes need attention.' }) });
    await act(async () => button('Pull from GitHub').click());
    expect(document.querySelector('[role="alert"]').textContent).toBe('Local changes need attention.');
    await act(async () => root.unmount()); root = null;
    await mount(undefined);
    expect(button('Pull from GitHub').disabled).toBe(true);
  });
});
