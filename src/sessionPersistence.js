/** Persist a summary only against the exact history used to produce it. */
export async function persistSessionSummary(api, source, memorySummary, summarizedMessageCount) {
  if (memorySummary === (source.memory_summary || "") && summarizedMessageCount === (source.summarized_message_count || 0)) return source;
  return api.updateSessionMetadata(source.id, { memorySummary, summarizedMessageCount, expectedRevision: source.revision });
}
