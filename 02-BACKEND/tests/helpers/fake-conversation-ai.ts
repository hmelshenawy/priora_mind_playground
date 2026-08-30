import type { LlmRequest, LlmResponse } from '../../src/modules/ai/llm.types';

/** Deterministic provider fake for the two fixed-pipeline LLM calls. */

export class FakeConversationAi {
  answerCalls = 0;
  ragMessageCalls = 0;
  requests: LlmRequest[] = [];

  constructor(private readonly ragMessages: string[] = []) {}

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    if (request.schemaName === 'rag_message') {
      this.ragMessageCalls += 1;
      const input = JSON.parse(request.input) as { userMessage: string };
      return {
        content: { ragMessage: this.ragMessages.shift() ?? input.userMessage.trim() },
        usage: { prompt: 0, completion: 0, total: 0 },
        latencyMs: 0,
        modelId: 'fake-conversation-ai',
      };
    }
    this.answerCalls += 1;
    const input = JSON.parse(request.input) as {
      ragResponse: { chunks: Array<{ chunk_id: string; source_id: string; text_hash: string }> };
    };
    const firstChunk = input.ragResponse.chunks[0];
    return {
      content: {
        content: firstChunk
          ? 'Fixture grounded conversation answer.'
          : 'Fixture conversational answer.',
        citations: firstChunk
          ? [{ chunk_id: firstChunk.chunk_id, source_id: firstChunk.source_id, text_hash: firstChunk.text_hash }]
          : [],
      },
      usage: { prompt: 0, completion: 0, total: 0 },
      latencyMs: 0,
      modelId: 'fake-conversation-ai',
    };
  }

}
