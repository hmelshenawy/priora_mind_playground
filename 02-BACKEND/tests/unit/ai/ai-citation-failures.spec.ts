import { describe, expect, it } from 'vitest';
import { mapCitations } from '../../../src/modules/ai/ai.service';

describe('conversation LLM failures', () => {
  it('rejects unsupported citations before persistence', () => {
    expect(() =>
      mapCitations(
        [{ chunk_id: 'unknown', source_id: 'source-1', text_hash: 'hash-1' }],
        [],
      ),
    ).toThrow('UNKNOWN_RAG_CITATION');
  });
});
