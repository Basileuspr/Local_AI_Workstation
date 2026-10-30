// Keep existing routes usable by Browser, Functions, pins, refresh and captures.
export const DESIGN_TAB = 'design-programming';
export const designTools = [
  { id: 'styling-library', label: 'Styling Library', title: 'Styling Library · CSS, HTML, buttons, layouts and animations' },
  { id: 'html-viewer', label: 'HTML Viewer' },
  { id: 'css-viewer', label: 'CSS / Styling' },
  { id: 'js-viewer', label: 'JavaScript Viewer' },
  { id: 'markdown', label: 'Markdown Viewer' },
];
export const isDesignTab = tab => tab === DESIGN_TAB || designTools.some(item => item.id === tab);
