import type { GroundedAnswerResult } from '../conversation-llm.types';
import type { AssistantSourceRowLike } from '../dto/conversation-presenter';
import type { RetrievedChunk } from '../../rag/rag.types';

/** Map the LLM's citations onto the retrieved chunks, throwing when a citation
 *  does not match the grounded evidence (caller treats as CITATION_VALIDATION). */
export function mapCitations(
  answer: GroundedAnswerResult,
  chunks: RetrievedChunk[],
): AssistantSourceRowLike[] {
  const allowed = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
  return answer.citations.map((citation, index) => {
    const chunk = allowed.get(citation.chunk_id);
    if (!chunk) throw new Error('UNKNOWN_RAG_CITATION');
    if (chunk.source_id !== citation.source_id || chunk.text_hash !== citation.text_hash) {
      throw new Error('RAG_CITATION_METADATA_MISMATCH');
    }
    return {
      chunkId: chunk.chunk_id,
      sourceId: chunk.source_id,
      sourceTitle: chunk.source_title,
      sourceFile: chunk.source_file ?? null,
      sourceType: chunk.source_type,
      chunkIndex: chunk.chunk_index,
      score: chunk.score,
      citationPage: chunk.citation_page ?? chunk.page_number ?? null,
      pageStart: chunk.page_start ?? null,
      pageEnd: chunk.page_end ?? null,
      citationHeading: chunk.citation_heading ?? null,
      citationSection: chunk.citation_section ?? null,
      textHash: chunk.text_hash,
      displayOrder: index + 1,
    };
  });
}