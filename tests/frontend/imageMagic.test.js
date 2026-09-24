import { describe, it, expect } from 'vitest';
import { magicLayout, magicSize } from '../../src/imageMagic';

describe('Magic Edit working dimensions', () => {
  it('raises the reproduced thumbnail failure to SDXL working resolution', () => {
    expect(magicSize(355, 374)).toEqual({ width: 976, height: 1024 });
    expect(magicLayout(355, 374).content).toEqual({ x: 2, y: 0, width: 972, height: 1024 });
  });

  it.each([[512, 512], [355, 374], [640, 400], [16000, 500], [12, 7200], [1, 1]])(
    'fits %s × %s without stretching the content to fill the working canvas', (width, height) => {
      const layout = magicLayout(width, height), content = layout.content;
      for (const value of [layout.width, layout.height]) {
        expect(value).toBeGreaterThanOrEqual(768);
        expect(value).toBeLessThanOrEqual(1024);
        expect(value % 8).toBe(0);
      }
      const scale = 1024 / Math.max(width, height);
      expect(Math.abs(content.width - width * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(content.height - height * scale)).toBeLessThanOrEqual(1);
      expect(content.x).toBeGreaterThanOrEqual(0);
      expect(content.y).toBeGreaterThanOrEqual(0);
      expect(content.x + content.width).toBeLessThanOrEqual(layout.width);
      expect(content.y + content.height).toBeLessThanOrEqual(layout.height);
    },
  );

  it('pads wide sources and uses the same geometry for portrait sources', () => {
    expect(magicLayout(400, 100)).toEqual({ width: 1024, height: 768, content: { x: 0, y: 256, width: 1024, height: 256 } });
    expect(magicLayout(100, 400)).toEqual({ width: 768, height: 1024, content: { x: 256, y: 0, width: 256, height: 1024 } });
  });

  it.each([[0, 512], [-1, 512], [NaN, 512], [Infinity, 512], [512, 0]])(
    'rejects invalid dimensions %s × %s', (width, height) => expect(() => magicSize(width, height)).toThrow('dimensions'),
  );
});
