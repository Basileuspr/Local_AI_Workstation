export const projectBrief = {
  title: 'A small project brief', filename: 'university-project-brief.txt', type: 'text/plain',
  text: 'Workshop project\nOwner: Morgan\nDraft review: 6 November 2026\nFinal handoff: 13 November 2026\nRequired outputs: a one-page summary and a diagram\nOpen question: who will review the diagram?\n',
};

export const inventoryCsv = {
  title: 'Practice inventory', filename: 'university-inventory.csv', type: 'text/csv',
  text: 'item,category,quantity,unit_cost_credits\nnotebook,stationery,3,4\npen,stationery,5,2\nfolder,stationery,2,3\ncable,electronics,1,8\n',
};

export const workshopMarkdown = {
  title: 'Practice Markdown', filename: 'university-workshop-notes.md', type: 'text/markdown',
  text: '# Workshop notes\n\n## Goal\nPrepare a one-page project summary.\n\n- Owner: Morgan\n- Draft review: 6 November 2026\n- Final handoff: 13 November 2026\n\n## Open question\nWho will review the diagram?\n',
};

export const sampleHtml = {
  title: 'HTML to inspect', filename: 'university-card.html', type: 'text/html',
  text: '<main>\n  <h1>Workshop project</h1>\n  <p class="deadline">Draft review: 6 November 2026</p>\n  <button>Review draft</button>\n</main>\n',
};

export const recordingScript = {
  title: 'A short recording script',
  text: 'The workshop draft is due on the sixth of November. Morgan owns the summary. We still need someone to review the diagram. The final handoff is on the thirteenth of November.',
};

// A 20 mm cube with twelve outward-facing triangles; no downloaded asset needed.
const cubeVertices = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]];
const cubeFaces = [
  [[0, 0, -1], [0, 2, 1]], [[0, 0, -1], [0, 3, 2]],
  [[0, 0, 1], [4, 5, 6]], [[0, 0, 1], [4, 6, 7]],
  [[0, -1, 0], [0, 1, 5]], [[0, -1, 0], [0, 5, 4]],
  [[1, 0, 0], [1, 2, 6]], [[1, 0, 0], [1, 6, 5]],
  [[0, 1, 0], [2, 3, 7]], [[0, 1, 0], [2, 7, 6]],
  [[-1, 0, 0], [3, 0, 4]], [[-1, 0, 0], [3, 4, 7]],
];
export const cubeStl = {
  title: 'Practice cube · 20 × 20 × 20 mm', filename: 'university-cube.stl', type: 'model/stl',
  text: ['solid university_cube', ...cubeFaces.flatMap(([normal, indices]) => [
    `  facet normal ${normal.join(' ')}`, '    outer loop',
    ...indices.map(index => `      vertex ${cubeVertices[index].join(' ')}`),
    '    endloop', '  endfacet',
  ]), 'endsolid university_cube', ''].join('\n'),
};
