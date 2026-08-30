/** Shared LLM contracts. Business modules build `LlmRequest`s and consume
 *  `LlmResponse`s; the configured provider implementation is interchangeable. */

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
  content: unknown;
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