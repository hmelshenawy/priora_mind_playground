import { describe, expect, it } from 'vitest';
import { mapCitations } from '../../../src/modules/conversations/utils/conversation-citation-mapper';

describe('conversation LLM failures', () => {
  it('rejects unsupported citations before persistence', () => {
    expect(() =>
      mapCitations(
        {
          content: 'Grounded answer',
          citations: [{ chunk_id: 'unknown', source_id: 'source-1', text_hash: 'hash-1' }],
          modelId: 'fake',
        },
        [],
      ),
    ).toThrow('UNKNOWN_RAG_CITATION');
  });
});
