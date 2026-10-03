import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import FaceHelp, { FaceHelpQuestion } from '../../src/components/FaceHelp';
import { comparisonFace, getFaceQuestions, personForName, saveFaceAnswer, undoFaceAnswer } from '../../src/faceHelp';

afterEach(() => vi.unstubAllGlobals());
const people = [{ id: 'p1', name: 'Alex', named: true, count: 3, reference_ids: ['f1', 'f2'] }];
const question = { face_id: 'f1', version: 'v1', source: { source: 'library', id: 'image', name: 'Photo.png' },
  suggestion: { ...people[0], reference_id: 'f2' }, reasons: ['Small face.'], view: 'comparison' };

it('opens help explicitly without fetching or replacing the game', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const html = renderToStaticMarkup(<FaceHelp active />);
  expect(html).toContain('Help identify faces'); expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('<dialog'); expect(fetch).not.toHaveBeenCalled();
});

it('shows the proposed name, a distinct reference, and manual answer controls', () => {
  const html = renderToStaticMarkup(<FaceHelpQuestion question={question} people={people} busy={false} />);
  expect(html).toContain('Does this look like Alex?'); expect(html).toContain('Reference for Alex');
  expect(html).toContain('/visual-review/faces/f2'); expect(html).toContain('Person’s name');
  expect(html).toContain('Skip / not sure'); expect(html).toContain('Show photo context');
  expect(html).toContain('Small face.');
});

it('offers a single face with a name field when there is no known reference', () => {
  const html = renderToStaticMarkup(<FaceHelpQuestion question={{ ...question, suggestion: null, view: 'single' }} people={[]} busy={false} />);
  expect(html).toContain('Who does this look like?'); expect(html).not.toContain('Reference for');
  expect(html).toContain('disabled="">Yes');
});

it('avoids ambiguous same-name groups and never compares a face with itself', () => {
  expect(personForName(people, ' alex ')).toBe(people[0]);
  expect(personForName([...people, { id: 'p2', name: 'Alex' }], 'Alex')).toBeNull();
  expect(comparisonFace({ ...question, suggestion: null }, people[0])).toBe('f2');
  expect(comparisonFace(question, null)).toBeNull();
});

it('uses the existing authenticated REVIEW API for answers, queue reads, and undo', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetch);
  await getFaceQuestions({ source: 'all', skip_ids: ['face'] });
  await saveFaceAnswer({ source: 'library', face_id: 'face', decision: 'no', version: 'v1' });
  await undoFaceAnswer({ source: 'library', face_id: 'face', undo_id: 'revision' });
  expect(fetch.mock.calls.map(call => call[0].split('/visual-review')[1])).toEqual(['/help/questions', '/help/answer', '/help/undo']);
  expect(JSON.parse(fetch.mock.calls[1][1].body).decision).toBe('no');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: 'This face changed in REVIEW.' }) }));
  await expect(saveFaceAnswer({})).rejects.toThrow('This face changed in REVIEW.');
});
