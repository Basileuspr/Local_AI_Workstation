export const KNOWLEDGE_NODE_KINDS = [
  { value: "note", label: "Note", hint: "A general note, topic, or piece of knowledge." },
  { value: "character", label: "Character", hint: "Character notes, biography, and an optional saved character profile." },
  { value: "idea", label: "Idea", hint: "A concept, question, or possibility to develop." },
  { value: "project", label: "Project", hint: "Goals, plans, tasks, and related resources." },
  { value: "place", label: "Place", hint: "A location, setting, or environment." },
  { value: "event", label: "Event", hint: "An occurrence, timeline entry, or milestone." },
  { value: "reference", label: "Reference", hint: "Source notes, facts, quotes, or links." },
];
export function newKnowledgeNodeDraft(nodes = []) {
  const titles = new Set(nodes.map(node => (node.node_title || node.options?.label || '').toLocaleLowerCase()));
  let title = 'Untitled node', number = 2;
  while (titles.has(title.toLocaleLowerCase())) title = `Untitled node ${number++}`;
  return { title, kind: 'note', text: '' };
}

export function knowledgeNodeDraft(draft) {
  const title = draft.title.trim();
  if (!title || title.length > 100 || /[\x00-\x1f]/.test(title)) throw new Error("Give the node a title on one line (up to 100 characters).");
  if (!KNOWLEDGE_NODE_KINDS.some(kind => kind.value === draft.kind)) throw new Error("Choose a node type.");
  if (draft.text.length > 100000) throw new Error("Node content must be at most 100,000 characters.");
  const result = { title, kind: draft.kind, text: draft.text };
  if (draft.kind === 'character') {
    const id = draft.character_id || '';
    if (id && !/^[a-f0-9]{32}$/.test(id)) throw new Error('Choose a saved character profile.');
    result.character_id = id;
  }
  return result;
}
