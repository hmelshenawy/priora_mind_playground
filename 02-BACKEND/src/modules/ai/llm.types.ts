/** Shared LLM contracts. Business modules build `LlmRequest`s and consume
 *  `LlmResponse`s; the configured provider implementation is interchangeable.
 *  `AiService.respond()` consumes these to produce `AiResponse` values. */

export interface LlmRequest {
  instructions: string;
  input: string;
  /** Correlation id used only for redaction-safe failure logging. */
  requestId?: string;
  /** Required by current structured-output flows (conversation + coaching). */
  schemaName?: string;
  schema?: Record<string, unknown>;
}

export interface LlmResponse {
  /** Parsed (JSON) provider output; consumers validate and narrow it. */
  content: string;
  modelId: string;
  latencyMs: number;
  usage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

export interface LlmProvider {
  generate(request: LlmRequest): Promise<LlmResponse>;
}

/** One prior message from the conversation, oldest first. */
export interface ConversationHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

/** Input for AiService.respond(): exactly what the user sent plus the
 *  conversation-provided recent history. */
export interface AiRespondInput {
  userMessage: string;
  history: ConversationHistoryItem[];
  messageTraceId: string;
}

/** Where an (attempted) AI turn ended — persisted by the caller as
 *  `processingStage` on the assistant message. */
export type AiStage = 'RAG' | 'LLM' | 'CITATION_VALIDATION';

/** A validated, retrieved-source snapshot ready for the caller's persistence. */
export interface AiSource {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceFile: string | null;
  sourceType: string;
  chunkIndex: number;
  score: number;
  citationPage: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  citationHeading: string | null;
  citationSection: string | null;
  textHash: string;
  displayOrder: number;
}

/** Why a completed (non-FAILED) turn could not produce generated content.
 *  The caller substitutes its own product copy for the reason. */

/** Final result of the fixed conversation AI pipeline. */
export type AiResponse = {
  status: 'ok' | 'failed';
  stage: AiStage;
  /** Kept so Conversation can map the retrieval message to its legacy DB field. */
  ragMessage: string | null;
  content: string | null;
  citations: AiSource[];
  modelId: string | null;
  usage: LlmResponse['usage'] | null;
  latencyMs: number | null;
  /** Only set when status is 'failed'. */
  failureCode?: string;
};
