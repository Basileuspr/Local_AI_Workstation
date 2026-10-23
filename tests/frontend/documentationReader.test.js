import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the offline reader's logic without claiming browser/layout acceptance.
function reader() {
  const html = readFileSync(new URL('../../docs/application-review/index.html', import.meta.url), 'utf8');
  const payload = html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', innerHTML: '', textContent: '', events: {},
    addEventListener(name, callback) { this.events[name] = callback; },
  }]));
  elements.get('review-data').textContent = payload;
  const context = vm.createContext({ document: { getElementById(id) {
    if (!elements.has(id)) throw new Error(`Missing reader element: ${id}`);
    return elements.get(id);
  } } });
  vm.runInContext(script, context, { timeout: 5000 });
  return { elements, context };
}

describe('documentation reader', () => {
  it('renders dated narrative separately from captured identity and compares observations', () => {
    const { elements } = reader();
    expect(elements.get('overview-content').innerHTML).toContain('packages with advisories');
    expect(elements.get('overview-content').innerHTML).toContain('Latest retained source snapshot');
    expect(elements.get('comparison').innerHTML).toContain('Version changes');
    const before = elements.get('before').value;
    const after = elements.get('after').value;
    elements.get('swap').events.click();
    expect(elements.get('before').value).toBe(after);
    expect(elements.get('after').value).toBe(before);
  });

  it('filters findings and recorded commit history', () => {
    const { elements } = reader();
    elements.get('finding-search').value = 'remediation';
    elements.get('finding-search').events.input();
    expect(elements.get('finding-content').innerHTML).toContain('D01');
    expect(elements.get('finding-content').innerHTML).not.toContain('D02');
    elements.get('history-search').value = 'no-such-recorded-commit-123';
    elements.get('history-search').events.input();
    expect(elements.get('history-content').innerHTML).toContain('No matching commits');
  });

  it('routes historical public names and leaves private records unlinked', () => {
    const { context } = reader();
    expect(vm.runInContext('sourceLink("DUAL_CHAT.md")', context)).toContain('docs/chat/CHAT_GUIDE.md#second-chat');
    const privateRecord = vm.runInContext('sourceLink("HANDOFF.md")', context);
    expect(privateRecord).toContain('private historical record');
    expect(privateRecord).not.toContain('href=');
  });
});
