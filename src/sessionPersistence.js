/** Persist a summary only against the exact history used to produce it. */
export async function persistSessionSummary(api, source, memorySummary, summarizedMessageCount) {
  if (memorySummary === (source.memory_summary || "") && summarizedMessageCount === (source.summarized_message_count || 0)) return source;
  return api.updateSessionMetadata(source.id, { memorySummary, summarizedMessageCount, expectedRevision: source.revision });
}

/** Update names without loading a chat or copying its server history. */
export function applySessionRename(dispatch, saved) {
  dispatch({ type: 'SESSION_METADATA_SAVED', payload: saved });
  dispatch({ type: 'SESSION_TITLE_UPDATED', payload: { id: saved.id, title: saved.title } });
}
