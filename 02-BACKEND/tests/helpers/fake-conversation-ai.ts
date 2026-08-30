import type { LlmRequest, LlmResponse } from '../../src/modules/ai/llm.types';

/** Deterministic fake of AiService.generate for conversation flows: returns
 *  already-parsed structured content keyed on the request's schemaName. */
export class FakeConversationAi {
  groundedAnswerCalls = 0;
  rewriteCalls = 0;

  async generate(request: LlmRequest): Promise<LlmResponse> {
    if (request.schemaName === 'follow_up_rewrite') {
      this.rewriteCalls += 1;
      const input = JSON.parse(request.input) as { recentHistory: Array<{ content: string }>; currentMessage: string };
      const lastTopic = [...input.recentHistory].reverse().find((item) => item.content.trim())?.content;
      return {
        content: {
          standaloneRetrievalQuery: lastTopic
            ? `${input.currentMessage.trim()} about ${lastTopic.trim()}`
            : input.currentMessage.trim(),
        },
        usage: { prompt: 0, completion: 0, total: 0 },
        latencyMs: 0,
        modelId: 'fake-conversation-ai',
      };
    }
    this.groundedAnswerCalls += 1;
    const input = JSON.parse(request.input) as {
      supportingEvidence: Array<{ chunk_id: string; source_id: string; text_hash: string }>;
    };
    const firstChunk = input.supportingEvidence[0];
    return {
      content: {
        content: 'Fixture grounded conversation answer.',
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