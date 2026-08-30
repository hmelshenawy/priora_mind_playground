import { describe, expect, it } from 'vitest';
import { buildAnswerLlmRequest, buildRagMessageLlmRequest } from '../../../src/modules/ai/ai-build-prompts';

const history = [{ role: 'user' as const, content: 'What is CBT?' }];
const chunk = {
  chunk_id: 'chunk-1', text: 'CBT evidence', score: 0.9, source_id: 'source-1',
  source_title: 'CBT Guide', source_type: 'pdf' as const, chunk_index: 1, text_hash: 'hash-1',
};

describe('AI prompt builders', () => {
  it('builds the retrieval-message request from userMessage and history', () => {
    const request = buildRagMessageLlmRequest({
      userMessage: 'How does it work?', history, messageTraceId: 'trace-1',
    });
    expect(request.schemaName).toBe('rag_message');
    expect(JSON.parse(request.input)).toEqual({ history, userMessage: 'How does it work?' });
  });

  it('builds the final answer from userMessage, history, and useful ragResponse only', () => {
    const request = buildAnswerLlmRequest({
      userMessage: 'What is CBT?', history, messageTraceId: 'trace-1',
      ragResponse: { status: 'ok', correlationId: 'trace-1', chunks: [chunk] },
    });
    const input = JSON.parse(request.input);
    expect(input).toMatchObject({ userMessage: 'What is CBT?', history, ragResponse: { status: 'ok' } });
    expect(input.ragMessage).toBeUndefined();
    expect(input.ragResponse.chunks[0]).toEqual({
      chunk_id: 'chunk-1', source_id: 'source-1', text_hash: 'hash-1', text: 'CBT evidence',
    });
  });

  it('builds a citation-free final request for not_enough_evidence', () => {
    const request = buildAnswerLlmRequest({
      userMessage: 'Thanks', history: [], messageTraceId: 'trace-1',
      ragResponse: { status: 'not_enough_evidence', correlationId: 'trace-1', chunks: [] },
    });
    expect(JSON.parse(request.input)).toEqual({
      userMessage: 'Thanks', history: [],
      ragResponse: { status: 'not_enough_evidence', chunks: [] },
    });
    expect(request.instructions).toContain('Return an empty citations array');
  });
});
