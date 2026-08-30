import type { ConversationHistoryItem, LlmRequest } from './llm.types';
import type { RagResponse } from '../rag/rag.types';

const RAG_MESSAGE_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['ragMessage'],
  properties: { ragMessage: { type: 'string', minLength: 1 } },
};

const ANSWER_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['content', 'citations'],
  properties: {
    content: { type: 'string', minLength: 1 },
    citations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['chunk_id', 'source_id', 'text_hash'],
        properties: {
          chunk_id: { type: 'string' }, source_id: { type: 'string' }, text_hash: { type: 'string' },
        },
      },
    },
  },
};

export function buildRagMessageLlmRequest(input: {
  userMessage: string;
  history: ConversationHistoryItem[];
  messageTraceId: string;
}): LlmRequest {
  return {
    requestId: input.messageTraceId,
    schemaName: 'rag_message',
    schema: RAG_MESSAGE_SCHEMA,
    instructions: [
      'Create one concise, self-contained message for knowledge retrieval.',
      'Resolve references using the conversation history.',
      'Preserve the current user intent. Do not answer the user.',
      'Return JSON matching the required schema.',
    ].join('\n'),
    input: JSON.stringify({ history: input.history, userMessage: input.userMessage }),
  };
}

export function buildAnswerLlmPrompt(input: {
  userMessage: string;
  history: ConversationHistoryItem[];
  ragResponse: RagResponse;
  messageTraceId: string;
}): LlmRequest {
  const chunks = input.ragResponse.status === 'ok' ? input.ragResponse.chunks : [];
  return {
    requestId: input.messageTraceId,
    schemaName: 'conversation_answer',
    schema: ANSWER_SCHEMA,
    instructions: [
      'You are Priora Mind, an evidence-grounded coaching and wellness assistant.',
      'Stay within approved coaching and wellness education boundaries. Do not diagnose, prescribe, provide medication advice, or claim to be a therapist.',
      'Respond in the language used by the current user message.',
      'Use conversation history naturally and keep the response concise.',
      chunks.length > 0
        ? 'Use only the supplied evidence for knowledge claims and cite each grounded claim.'
        : 'No useful retrieved evidence is available. Respond from the user message and history without unsupported knowledge claims.',
      chunks.length > 0
        ? 'Citations must exactly copy chunk_id, source_id, and text_hash from supplied evidence.'
        : 'Return an empty citations array.',
      'Do not put citation IDs or metadata in the user-facing content.',
      'Return JSON matching the required schema.',
    ].join('\n'),
    input: JSON.stringify({
      userMessage: input.userMessage,
      history: input.history,
      ragResponse: {
        status: input.ragResponse.status,
        chunks: chunks.map((chunk) => ({
          chunk_id: chunk.chunk_id,
          source_id: chunk.source_id,
          text_hash: chunk.text_hash,
          text: chunk.text,
        })),
      },
    }),
  };
}
