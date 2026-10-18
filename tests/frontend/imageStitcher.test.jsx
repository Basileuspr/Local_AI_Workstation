import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { initialStitchState, stitchReducer, stitchKey, selectionInPickOrder } from '../../src/imageStitcher';
import ImageViewer from '../../src/components/ImageViewer';
import CollectionImages from '../../src/components/CollectionImages';
import { workflowViewerImages, WorkflowImageCards } from '../../src/components/WorkflowImageLibrary';
import { sourceFor } from '../../src/imageLibraryApi';

const images = ['first', 'rejected', 'third'].map(id => ({ id, name: id, library: true, url: `/images/${id}` }));
const add = (state, frames) => stitchReducer(state, { type: 'add', images: frames });

it('skips failed attempts, appends picks in click order and deduplicates renamed sources', () => {
  let state = add(initialStitchState, [images[2], images[0]]);
  state = add(state, [{ ...images[2], name: 'Renamed frame' }]);
  expect(state.frames.map(image => image.id)).toEqual(['third', 'first']);
  state = stitchReducer(state, { type: 'move', key: stitchKey(images[0]), direction: -1 });
  expect(state.frames.map(image => image.id)).toEqual(['first', 'third']);
  state = stitchReducer(state, { type: 'remove', key: stitchKey(images[0]) });
  expect(state.frames).toEqual([images[2]]);
  expect(stitchReducer(state, { type: 'move', key: stitchKey(images[2]), direction: -1 })).toBe(state);
});

it('retains a tray while collapsed and accepts selections beyond the old cap', () => {
  let state = add(initialStitchState, images);
  state = stitchReducer(state, { value: { enabled: false } });
  expect(state.frames).toEqual(images);
  const oversized = Array.from({ length: 65 }, (_, index) => ({ id: String(index), library: true }));
  const result = add(state, oversized);
  expect(result.frames).toEqual([...images, ...oversized]);
  expect(result.error).toBe('');
  expect(stitchReducer(state, { type: 'reverse' }).frames).toEqual([...images].reverse());
});

it('transfers the selected IDs in pick order across pages instead of display order', () => {
  expect(selectionInPickOrder({ items: images, ids: new Set(['third', 'first', 'gone']) })).toEqual([images[2], images[0]]);
});

const stitcher = { enabled: true, frames: [images[0]], number: image => image.id === 'first' ? 1 : 0 };
it('makes frame selection available from enlarged viewers and saved cards', () => {
  const html = renderToStaticMarkup(<ImageViewer images={images} selectedId="third" stitcher={stitcher} />);
  expect(html).toContain('Add third to stitcher');
  expect(html).toContain('Browse past unwanted attempts');
  expect(html).toContain('Preview stitch');
  const cards = renderToStaticMarkup(<CollectionImages images={images} stitcher={stitcher} />);
  expect(cards).toContain('Frame 1 · Remove');
  expect(cards).toContain('Add third to stitcher');
  expect(renderToStaticMarkup(<ImageViewer images={images} selectedId="third" />)).not.toContain('Stitch this scene');
});

it('keeps workflow frame identities consistent between thumbnails and enlarged views', () => {
  const run = { workflow_id: 'workflow', id: 'job', workflow_name: 'Scene', outputs: [{ id: 'output', stage_number: 3, url: '/output' }], composites: [{ layout: 'row', url: '/row' }] };
  const items = workflowViewerImages([run]);
  expect(sourceFor(items[0])).toMatchObject({ kind: 'workflow', output_id: 'output', workflow_id: 'workflow', job_id: 'job' });
  expect(sourceFor(items[1])).toMatchObject({ kind: 'workflow', layout: 'row' });
  expect(stitchKey(items[0])).toBe(stitchKey({ ...run.outputs[0], run, id: 'workflow:job:output' }));
  const html = renderToStaticMarkup(<WorkflowImageCards runs={[run]} stitcher={stitcher} />);
  expect(html).toContain('Add Stage 3 to stitcher');
});
