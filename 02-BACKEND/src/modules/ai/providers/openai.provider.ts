import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import type { LlmProvider, LlmRequest, LlmResponse } from '../llm.types';

/** OpenAI Responses API provider with strict JSON-schema structured output. */
export class OpenAiProvider implements LlmProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            instructions: request.instructions,
            input: request.input,
            text: {
              format: {
                type: 'json_schema',
                name: request.schemaName,
                strict: true,
                schema: request.schema,
              },
            },
          }),
          signal: controller.signal,
        });
      } catch (error) {
        // fetch() only rejects on transport-level failures: our own timeout
        // abort (or undici's), or a connection error.
        if (isAbortError(error)) throw new GatewayTimeoutException('OpenAI request timed out');
        throw new BadGatewayException('OpenAI provider is unreachable');
      }
      const body = await this.readBody(response);
      return this.toResponse(body, Date.now() - started);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reads the response body and converts HTTP failures into a safe 502 that
   *  carries only the provider's own error message (never raw bodies, headers,
   *  keys, prompts, or stack traces). */
  private async readBody(response: Response): Promise<Record<string, unknown>> {
    console.log("AI Response As::", response)
    let body: unknown = null;
    try {
      body = await response.json();
      console.log('AI Response Body:::', body);
    } catch {
      // Not JSON — fall through; !ok surfaces a generic message, ok surfaces a malformed-output message below.
    }
    if (!response.ok) {
      const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
      throw new BadGatewayException(
        typeof message === 'string' && message.trim() ? message : 'OpenAI request failed',
      );
    }
    return (body ?? {}) as Record<string, unknown>;
  }

  /** Extracts text, parses the JSON payload, and normalizes usage/model/latency. */
  private toResponse(body: Record<string, unknown>, latencyMs: number): LlmResponse {
    const raw = this.readText(body);
    if (!raw) throw new BadGatewayException('OpenAI returned a malformed response');
    try {
      return {
        content: JSON.parse(raw),
        usage: this.readUsage(body),
        latencyMs,
        modelId: typeof body.model === 'string' && body.model.trim() ? body.model : this.model,
      };
    } catch {
      throw new BadGatewayException('OpenAI returned a malformed response');
    }
  }

  private readText(body: Record<string, unknown>): string | null {
    if (typeof body.output_text === 'string') return body.output_text;
    const output = Array.isArray(body.output) ? body.output : [];
    for (const item of output) {
      const content = Array.isArray((item as { content?: unknown }).content)
        ? ((item as { content: unknown[] }).content ?? [])
        : [];
      for (const part of content) {
        if (
          (part as { type?: unknown }).type === 'output_text' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text;
        }
      }
    }
    return null;
  }

  private readUsage(body: Record<string, unknown>): LlmResponse['usage'] {
    const usage = body.usage as Record<string, unknown> | undefined;
    if (!usage) return undefined;
    return {
      prompt: usageNumber(usage.input_tokens),
      completion: usageNumber(usage.output_tokens),
      total: usageNumber(usage.total_tokens),
    };
  }
}

function usageNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Detects an abort whether it surfaced directly or wrapped by undici (which
 *  sometimes rejects with `TypeError: fetch failed` whose cause is AbortError). */
function isAbortError(error: unknown): boolean {
  const e = error as { name?: string; cause?: { name?: string } } | undefined;
  return e?.name === 'AbortError' || e?.cause?.name === 'AbortError';
}