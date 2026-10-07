import { expect, it } from 'vitest';
import { filterNavigationSections, orderedSections } from '../../src/navigationOrder';

it('finds tabs by their visible name, full title, and route words across groups', () => {
  const sections = orderedSections();
  const ids = query => filterNavigationSections(sections, query).flatMap(section => section.items.map(item => item.id));
  expect(ids('  GENERATE images ')).toEqual(['generate']);
  expect(ids('image review')).toEqual(['review']);
  expect(ids('local files')).toEqual(['local-files']);
  expect(ids('3D')).toEqual(['slicer', '3d-viewer']);
  expect(ids('nothing-matches-this')).toEqual([]);
  expect(filterNavigationSections(sections, '   ')).toEqual(sections);
});

it('keeps saved group and tab priorities in search results without altering the menu', () => {
  const sections = orderedSections({ sections: ['viewers', 'images'], tabs: { images: ['generate', 'image-manager'] } });
  const original = structuredClone(sections);
  const results = filterNavigationSections(sections, 'image');
  expect(results[0].id).toBe('images');
  expect(results[0].items.slice(0, 2).map(item => item.id)).toEqual(['generate', 'image-manager']);
  expect(filterNavigationSections(sections, 'viewer')[0].id).toBe('viewers');
  expect(sections).toEqual(original);
});
