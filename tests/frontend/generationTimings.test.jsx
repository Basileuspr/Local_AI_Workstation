import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ImageGenerationTimings from '../../src/components/ImageGenerationTimings';

it('shows measured stages and total without inventing timings for older results', () => {
  expect(renderToStaticMarkup(<ImageGenerationTimings result={{}} />)).toBe('');
  const html = renderToStaticMarkup(<ImageGenerationTimings result={{ request_seconds: 12.5, stage_seconds: {denoising: 10.21, png_save: 0.15, invalid: NaN} }} />);
  expect(html).toContain('12.5s total');
  expect(html).toContain('Denoising');
  expect(html).toContain('10.21s');
  expect(html).toContain('PNG saving');
  expect(html).not.toContain('NaN');
});
