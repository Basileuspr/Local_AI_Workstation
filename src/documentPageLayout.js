export const PAGE_STORIES = ['header', 'footer', 'firstHeader', 'firstFooter', 'evenHeader', 'evenFooter'];
export const PAGE_DETAIL_DEFAULTS = {
  ...Object.fromEntries(PAGE_STORIES.map(key => [key, ''])),
  ...Object.fromEntries(PAGE_STORIES.map(key => [`${key}Alignment`, 'left'])),
  differentFirstPage: false, differentOddEven: false, headerDistance: .5, footerDistance: .5,
  pageNumbers: false, pageNumberPosition: 'footer', pageNumberAlignment: 'center',
  pageNumberStyle: 'page', pageNumberFormat: 'decimal', pageNumberStart: 1, pageNumberFirstPage: true,
};
export const PAGINATION_OPTIONS = [
  ['pageBreakBefore', 'Page break before', 'Start this paragraph on a new page.'],
  ['keepWithNext', 'Keep with next', 'Keep this paragraph with the following paragraph.'],
  ['keepTogether', 'Keep lines together', 'Keep all lines of this paragraph on the same page.'],
  ['widowControl', 'Widow/orphan control', 'Keep at least two lines together at the top or bottom of a page.'],
];
export const PAGE_NUMBER_FORMATS = [
  ['decimal', '1, 2, 3'], ['lowerRoman', 'i, ii, iii'], ['upperRoman', 'I, II, III'],
  ['lowerLetter', 'a, b, c'], ['upperLetter', 'A, B, C'],
];

export function pageVariants(layout) {
  return [
    ['default', layout.differentOddEven ? 'Odd pages' : 'Regular pages'],
    ...(layout.differentFirstPage ? [['first', 'First page']] : []),
    ...(layout.differentOddEven ? [['even', 'Even pages']] : []),
  ];
}

export function storyKey(variant, position) {
  return variant === 'default' ? position : variant + position[0].toUpperCase() + position.slice(1);
}

export function pageNumberText(layout, current = '{PAGE}', total = '{NUMPAGES}') {
  if (layout.pageNumberStyle === 'number') return current;
  return `Page ${current}${layout.pageNumberStyle === 'pageOf' ? ` of ${total}` : ''}`;
}

export function pageStorySample(layout, variant, position) {
  const key = storyKey(variant, position);
  return {
    text: layout[key] || '', alignment: layout[`${key}Alignment`] || 'left',
    number: layout.pageNumbers && layout.pageNumberPosition === position && (variant !== 'first' || layout.pageNumberFirstPage)
      ? pageNumberText(layout) : '',
  };
}
