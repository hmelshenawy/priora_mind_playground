import { Injectable, Optional } from '@nestjs/common';
import type { AiService } from '../../ai/ai.service';
import type { ConversationHistoryItem, FollowUpRewriteResult } from '../conversation-llm.types';
import type { LlmRequest } from '../../ai/llm.types';

export const FOLLOW_UP_REWRITE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['standaloneRetrievalQuery'],
  properties: { standaloneRetrievalQuery: { type: 'string', minLength: 1 } },
};

export type FollowUpRewriteOutcome =
  | { status: 'ok'; result: FollowUpRewriteResult }
  | { status: 'insufficient_context' }
  | { status: 'failed'; failureCode: string };

@Injectable()
export class ConversationFollowUpRewriteService {
  constructor(@Optional() private readonly ai?: AiService) {}

  async rewrite(input: {
    correlationId: string;
    recentHistory: ConversationHistoryItem[];
    currentMessage: string;
  }): Promise<FollowUpRewriteOutcome> {
    if (input.recentHistory.length === 0) return { status: 'insufficient_context' };
    if (!this.ai) return { status: 'failed', failureCode: 'FOLLOW_UP_REWRITE_UNAVAILABLE' };
    try {
      const request: LlmRequest = {
        requestId: input.correlationId,
        instructions:
          'Rewrite the current message as one standalone retrieval query using only the supplied conversation history. Return JSON matching the required schema. Do not answer the question.',
        input: JSON.stringify({ recentHistory: input.recentHistory, currentMessage: input.currentMessage }),
        schemaName: 'follow_up_rewrite',
        schema: FOLLOW_UP_REWRITE_SCHEMA,
      };
      const response = await this.ai.generate(request);
      const result = response.content as Partial<FollowUpRewriteResult>;
      if (typeof result.standaloneRetrievalQuery !== 'string' || !result.standaloneRetrievalQuery.trim()) {
        return { status: 'failed', failureCode: 'FOLLOW_UP_REWRITE_FAILED' };
      }
      return {
        status: 'ok',
        result: {
          standaloneRetrievalQuery: result.standaloneRetrievalQuery,
          usage: response.usage,
          latencyMs: response.latencyMs,
          modelId: response.modelId,
        },
      };
    } catch {
      return { status: 'failed', failureCode: 'FOLLOW_UP_REWRITE_FAILED' };
    }
  }
}