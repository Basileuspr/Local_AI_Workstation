import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { documentExtensions, documentMatches, documentStats, pageDimensions } from '../../src/documentEditor';

const schema = getSchema(documentExtensions());
const model = content => schema.nodeFromJSON({ type: 'doc', content });
describe('document editor model', () => {
  it('finds across formatting boundaries without crossing paragraphs', () => {
    const doc = model([{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'world' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'HELLO world' }] }]);
    expect(documentMatches(doc, 'hello world')).toEqual([{ from: 1, to: 12 }, { from: 14, to: 25 }]);
    expect(documentMatches(doc, 'Hello', true)).toHaveLength(1);
    expect(documentMatches(doc, 'worldHELLO')).toEqual([]);
    expect(documentMatches(doc, '')).toEqual([]);
  });
  it('counts words and finds text correctly after hard breaks and inside tables', () => {
    const doc = model([{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'hardBreak' }, { type: 'text', text: 'target' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'target table' }] }] }] }] }]);
    expect(documentMatches(doc, 'target')).toHaveLength(2);
    const [first] = documentMatches(doc, 'target'); expect(doc.textBetween(first.from, first.to)).toBe('target');
    expect(documentStats(doc).paragraphs).toBe(2);
    expect(documentStats(doc).words).toBe(4);
  });
  it('keeps search offsets correct with Unicode and treats punctuation literally', () => {
    const doc = model([{ type: 'paragraph', content: [{ type: 'text', text: 'İB [a+b] B' }] }]);
    const matches = documentMatches(doc, 'b');
    expect(matches).toHaveLength(3);
    for (const match of matches) expect(doc.textBetween(match.from, match.to).toLowerCase()).toBe('b');
    expect(documentMatches(doc, '[a+b]')).toHaveLength(1);
  });
  it('models supported rich nodes, local pictures and paper orientation', () => {
    const doc = model([{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A heading' }] }, { type: 'pageBreak' },
      { type: 'image', attrs: { src: 'data:image/png;base64,abc', alt: 'Test', width: 200 } }]);
    expect(documentStats(doc)).toMatchObject({ pictures: 1, words: 2 });
    expect(pageDimensions({ paper: 'Letter', orientation: 'landscape' })).toEqual([11, 8.5]);
    expect(doc.child(1).type.name).toBe('pageBreak');
  });
});
