function documentDraft(draft) {
  return String(draft).replace(/^\/docx\b(?:\s+(?:append|add|continue)\b(?:\s+[a-f0-9]{32}\b)?)?\s*/i, '');
}

export function documentCreatePrompt(draft = '') {
  return `/docx ${documentDraft(draft)}`;
}

export function documentAppendPrompt(artifactId, draft = '') {
  if (!/^[a-f0-9]{32}$/.test(artifactId || '')) throw new Error('This document attachment is invalid.');
  const content = documentDraft(draft);
  return `/docx append ${content}`;
}

// Keep every saved reply in history, but supply only the latest cumulative
// document text to the model. Repeated additions must not multiply context use.
export function latestDocumentContextMessages(messages) {
  const families = message => (message.artifacts || []).filter(item => item.kind === 'docx').map(item => item.document_id || item.id);
  const latest = new Map();
  messages.forEach((message, index) => { if (message.document_text) for (const family of families(message)) latest.set(family, index); });
  return messages.map((message, index) => {
    const documents = families(message);
    return message.document_text && documents.length && documents.every(family => latest.get(family) > index)
      ? {...message, document_text: undefined} : message;
  });
}
