import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { DEFAULT_PAGE, documentExtensions } from '../../src/documentEditor';
import { PAGINATION_OPTIONS, pageVariants, pageStorySample, pageNumberText } from '../../src/documentPageLayout';

describe('document page layout', () => {
  it('retains nullable pagination overrides including explicit false', () => {
    const schema = getSchema(documentExtensions());
    const attrs = { pageBreakBefore: true, keepWithNext: false, keepTogether: true, widowControl: false };
    const node = schema.nodeFromJSON({ type: 'paragraph', attrs });
    expect(node.toJSON().attrs).toMatchObject(attrs);
    for (const [key] of PAGINATION_OPTIONS) expect(schema.nodes.paragraph.create().attrs[key]).toBeNull();
  });
  it('offers only enabled story variants, preserving separate first and even text', () => {
    expect(pageVariants(DEFAULT_PAGE)).toEqual([['default', 'Regular pages']]);
    const layout = { ...DEFAULT_PAGE, differentFirstPage: true, differentOddEven: true,
      header: 'Odd title', firstHeader: 'Title page', evenHeader: 'Even title', evenHeaderAlignment: 'right' };
    expect(pageVariants(layout).map(([key]) => key)).toEqual(['default', 'first', 'even']);
    expect(pageStorySample(layout, 'first', 'header').text).toBe('Title page');
    expect(pageStorySample(layout, 'even', 'header')).toMatchObject({ text: 'Even title', alignment: 'right' });
  });
  it('uses field placeholders instead of inventing a page count', () => {
    const layout = { ...DEFAULT_PAGE, pageNumbers: true, pageNumberStyle: 'pageOf',
      differentFirstPage: true, pageNumberFirstPage: false };
    expect(pageStorySample(layout, 'default', 'footer').number).toBe('Page {PAGE} of {NUMPAGES}');
    expect(pageStorySample(layout, 'first', 'footer').number).toBe('');
    expect(pageStorySample(layout, 'default', 'header').number).toBe('');
    expect(pageNumberText({ pageNumberStyle: 'number' })).toBe('{PAGE}');
  });
});
