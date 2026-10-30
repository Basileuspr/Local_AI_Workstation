import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { clampPan, fitScale, zoomAt } from '../../src/imageZoom';
import ImageZoom from '../../src/components/ImageZoom';

it('fits a large grid and a rotated strip, keeping actual-size scale independent', () => {
  expect(fitScale(6144, 6144, { width: 1000, height: 600 })).toBeCloseTo(600 / 6144);
  expect(fitScale(46080, 768, { width: 1000, height: 600 }, 90)).toBeCloseTo(600 / 46080);
  expect(fitScale(200, 100, { width: 1000, height: 600 })).toBe(1);
});

it('keeps the cursor pixel anchored when zooming and allows panning to every edge', () => {
  expect(zoomAt({ x: 0, y: 0 }, .1, 1, { x: 100, y: 50 })).toEqual({ x: -900, y: -450 });
  expect(clampPan({ x: 9999, y: -9999 }, 6144, 6144, { width: 1000, height: 600 }, 1)).toEqual({ x: 2572, y: -2772 });
  expect(clampPan({ x: 9999, y: -9999 }, 6144, 6144, { width: 1000, height: 600 }, 600 / 6144)).toEqual({ x: 0, y: 0 });
});

it('shows explicit zoom controls and starts from the small preview', () => {
  const html = renderToStaticMarkup(<ImageZoom src="/original.png" previewSrc="/preview.png" width={6144} height={6144} alt="Grid" />);
  for (const text of ['Zoom in', 'Zoom out', '100%', 'Fit', 'Drag to pan']) expect(html).toContain(text);
  expect(html).toContain('/preview.png'); expect(html).not.toContain('src="/original.png');
});
