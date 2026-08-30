import type { LlmRequest } from '../../ai/llm.types';
import type {
  GroundedAnswerRequest,
  ConversationHistoryItem,
} from '../conversation-llm.types';
import type { RetrievedChunk } from '../../rag/rag.types';
import { CONVERSATION_SYSTEM_INSTRUCTIONS } from '../constants/conversation-system.prompt';

/** Assemble the grounded prompt parts for a conversation turn. */
export function buildGroundedPrompt(input: {
  recentHistory: ConversationHistoryItem[];
  currentMessage: string;
  standaloneRetrievalQuery: string;
  chunks: RetrievedChunk[];
}): Omit<GroundedAnswerRequest, 'correlationId'> {
  return {
    productInstructions: [...CONVERSATION_SYSTEM_INSTRUCTIONS],
    recentHistory: input.recentHistory,
    currentMessage: input.currentMessage,
    standaloneRetrievalQuery: input.standaloneRetrievalQuery,
    chunks: input.chunks,
  };
}

export const GROUNDED_ANSWER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['content', 'citations'],
  properties: {
    content: { type: 'string', minLength: 1 },
    citations: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['chunk_id', 'source_id', 'text_hash'],
        properties: {
          chunk_id: { type: 'string' },
          source_id: { type: 'string' },
          text_hash: { type: 'string' },
        },
      },
    },
  },
};

/** Turn the grounded prompt into the LlmRequest sent to the configured
 *  provider — instructions, input payload, and structured-output schema. */
export function buildGroundedLlmRequest(
  prompt: Omit<GroundedAnswerRequest, 'correlationId'>,
  correlationId: string,
): LlmRequest {
  return {
    requestId: correlationId,
    instructions: [
      ...prompt.productInstructions,
      'Return concise JSON matching the required schema.',
      'When supporting evidence is supplied, return non-empty content and at least one citation.',
      'Citations must exactly copy chunk_id, source_id, and text_hash from supplied chunks.',
      'Each citation object must contain exactly chunk_id, source_id, and text_hash with no additional fields.',
    ].join('\n'),
    input: JSON.stringify({
      turnContext: {
        isContinuingConversation: prompt.recentHistory.length > 0,
        mustAdvanceBeyondPriorAssistantResponses: prompt.recentHistory.some(
          (item) => item.role === 'assistant',
        ),
      },
      conversationHistoryChronological: prompt.recentHistory,
      currentUserMessage: prompt.currentMessage,
      standaloneRetrievalQuery: prompt.standaloneRetrievalQuery,
      supportingEvidence: prompt.chunks.map((chunk) => ({
        chunk_id: chunk.chunk_id,
        source_id: chunk.source_id,
        text_hash: chunk.text_hash,
        text: chunk.text,
      })),
    }),
    schemaName: 'grounded_answer',
    schema: GROUNDED_ANSWER_SCHEMA,
  };
}