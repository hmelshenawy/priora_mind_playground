import { CONVERSATION_LIMITS } from '../constants/conversation.constants';
import type { RetrievedChunk, RetrievalSearchResult } from '../../rag/rag.types';

/** Select the valid, un-duplicated, above-threshold chunks that fit the prompt
 *  context budget. Returns [] when the retrieval result is not 'ok'. */
export function selectSufficientChunks(result: RetrievalSearchResult): RetrievedChunk[] {
  if (result.status !== 'ok') return [];
  const seen = new Set<string>();
  let remainingChars = CONVERSATION_LIMITS.ragMaxContextChars;
  const selected: RetrievedChunk[] = [];

  for (const chunk of result.chunks) {
    if (!isValidChunk(chunk)) continue;
    if (seen.has(chunk.chunk_id)) continue;
    if (chunk.score < CONVERSATION_LIMITS.ragScoreThreshold) continue;
    const textLength = chunk.text.trim().length;
    if (textLength > remainingChars) continue;
    selected.push(chunk);
    seen.add(chunk.chunk_id);
    remainingChars -= textLength;
    if (selected.length >= CONVERSATION_LIMITS.ragLimit) break;
  }

  return selected;
}

function isValidChunk(chunk: RetrievedChunk): boolean {
  return Boolean(
    chunk.chunk_id?.trim() &&
      chunk.text?.trim() &&
      chunk.source_id?.trim() &&
      chunk.source_title?.trim() &&
      chunk.text_hash?.trim() &&
      Number.isFinite(chunk.score) &&
      Number.isInteger(chunk.chunk_index),
  );
}