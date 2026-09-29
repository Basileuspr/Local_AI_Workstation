const CHARACTER_ID = /^[a-f0-9]{32}$/;
export function characterDocumentName(id, name = '') {
  if (!CHARACTER_ID.test(id || '')) throw new Error('Choose a saved character.');
  const title = name.trim().replace(/[<>:"/\\|?*\[\]#\x00-\x1f]/g,'_').slice(0,48).replace(/[ .]+$/g,'');
  return `Character-${title ? title+'-' : ''}${id}.md`;
}
export function characterIdFromDocument(filename) {
  return /^Character-(?:[^/\\\r\n]+-)?([a-f0-9]{32})\.md$/.exec(filename || '')?.[1] || '';
}
export function characterNoteFile(character, filename = characterDocumentName(character.id,character.name)) {
  if (characterIdFromDocument(filename) !== character.id) throw new Error('Character document does not match this profile.');
  const accepted = (character.members || []).filter(member => member.state === 'accepted');
  const text = [
    `# ${character.name}`, '', 'Character profile snapshot', '',
    `Character ID: ${character.id}`,
    `Open in the app: Character Creator → ${character.name}`,
    `Profile path relative to app data: face_bank/${character.id}.json`,
    `Knowledge link: [[${filename}]]`, '',
    '## Biography', character.bio || 'No biography yet.', '',
    '## Notes', character.notes || 'No notes yet.', '',
    '## Tags', (character.tags || []).join(', ') || 'No tags yet.', '',
    '## Face references',
    `Accepted faces: ${accepted.length}`,
    `Primary reference: ${character.primary_reference || 'Not selected'}`,
    ...accepted.map(member => `- Dataset ${member.dataset_id}; face ${member.face_id}${(character.additional_references || []).includes(member.face_id) ? '; additional reference' : ''}`), '',
    '## Linked resources',
    ...(character.resources || []).map(item => {
      const name=item.resource?.name || 'Unavailable reference';
      const title=item.kind==='knowledge' && item.available && !/[\[\]\r\n]/.test(name) ? `[[${name}]]` : name;
      return `- ${item.kind}: ${title}; ID ${item.target_id}${item.available === false ? ' (unavailable)' : ''}${item.note ? `\n  ${item.note}` : ''}`;
    }), '',
    'This node records saved profile details. Use Open character to edit the live profile, then Refresh character node to update this snapshot. Face images and embeddings are not embedded in this document.', '',
  ].join('\n');
  return new File([text], filename, {type:'text/markdown;charset=utf-8'});
}
