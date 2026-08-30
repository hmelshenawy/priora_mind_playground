import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import type { LlmProvider, LlmRequest, LlmResponse } from '../llm.types';

/** Ollama chat provider. Local models use native JSON-schema structured
 *  output; `:cloud` models only support JSON mode, so the schema is restated
 *  in the prompt and every response is validated against it here. */
export class OllamaProvider implements LlmProvider {
  constructor(
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly apiKey?: string,
  ) {}

  async generate(request: LlmRequest): Promise<LlmResponse> {
    // Fresh controller + timer per request — never reused across calls.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const started = Date.now();
      const schema = request.schema as Record<string, unknown>;
      const cloudModel = this.model.endsWith(':cloud');

      let response: Response;
      try {
        response = await fetch(this.chatUrl(), {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            model: this.model,
            stream: false,
            think: false,
            format: cloudModel ? 'json' : schema,
            messages: [
              {
                role: 'system',
                content: cloudModel
                  ? this.cloudInstructions(request.instructions, request.schemaName, schema)
                  : request.instructions,
              },
              { role: 'user', content: request.input },
            ],
          }),
          signal: controller.signal,
        });
      } catch (error) {
        // fetch() only rejects on transport-level failures. An abort is a
        // timeout whether it came from our own AbortController timer or from
        // the transport itself (undici sometimes surfaces an abort as
        // `TypeError: fetch failed` whose cause is an `AbortError`).
        if (isAbortError(error)) throw new GatewayTimeoutException('Ollama request timed out');
        throw new BadGatewayException('Ollama provider is unreachable');
      }

      // Read the body as text first so a mid-stream reset (network) is not
      // conflated with a JSON parse failure (invalid output).
      console.log("AI Response:::", response)
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await response.text());
        console.log("AI Response Body:::", body)
      } catch {
        throw response.ok
          ? new BadGatewayException('Ollama returned a malformed response')
          : new BadGatewayException(this.safeProviderMessage(null));
      }

      // Ollama can return HTTP 200 with a provider-level error object (e.g. an
      // upstream cloud failure). That is a transport/availability failure, not
      // model output, so it must not be treated as parseable content.
      if (typeof body.error === 'string' && body.error.trim()) {
        throw new BadGatewayException(body.error);
      }
      if (!response.ok) throw new BadGatewayException(this.safeProviderMessage(body));

      const parsed = this.toResponse(body, Date.now() - started, cloudModel);
      if (cloudModel && !matchesJsonSchema(parsed.content, schema)) {
        throw new BadGatewayException('Ollama returned an invalid response');
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Prefers Ollama's own safe error message when present; never exposes raw
   *  response bodies, headers, keys, prompts, or stack traces. */
  private safeProviderMessage(body: Record<string, unknown> | null): string {
    const message = body?.error;
    if (typeof message === 'string' && message.trim()) return message;
    return 'Ollama request failed';
  }

  private chatUrl(): string {
    const base = this.baseUrl.replace(/\/$/, '');
    return base.endsWith('/api') ? `${base}/chat` : `${base}/api/chat`;
  }

  private cloudInstructions(
    instructions: string,
    schemaName: string | undefined,
    schema: Record<string, unknown>,
  ): string {
    return [
      instructions,
      `Return only the root JSON object for schema ${schemaName}; do not wrap it in a property named ${schemaName}.`,
      'Do not use Markdown or prose outside the root JSON object.',
      `The response must exactly satisfy this JSON Schema: ${JSON.stringify(schema)}`,
    ].join('\n');
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** Extracts message content, parses the JSON payload (unwrapping a single
   *  markdown fence for cloud models), and normalizes usage/model/latency. */
  private toResponse(body: Record<string, unknown>, latencyMs: number, cloudModel: boolean): LlmResponse {
    const raw = (body.message as { content?: unknown } | undefined)?.content;
    if (typeof raw !== 'string') throw new BadGatewayException('Ollama returned a malformed response');
    try {
      return {
        content: JSON.parse(cloudModel ? unwrapJsonFence(raw) : raw),
        usage: this.readUsage(body),
        latencyMs,
        modelId: typeof body.model === 'string' && body.model.trim() ? body.model : this.model,
      };
    } catch {
      throw new BadGatewayException('Ollama returned a malformed response');
    }
  }

  private readUsage(body: Record<string, unknown>): LlmResponse['usage'] {
    const prompt = usageNumber(body.prompt_eval_count);
    const completion = usageNumber(body.eval_count);
    if (prompt === undefined && completion === undefined) return undefined;
    return {
      prompt,
      completion,
      total: prompt !== undefined && completion !== undefined ? prompt + completion : undefined,
    };
  }
}

function unwrapJsonFence(raw: string): string {
  const match = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? raw;
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

/** Minimal JSON-schema subset matcher (object/array/string/number/integer/null
 *  with required/additionalProperties/minLength/minItems/minimum) used to
 *  validate cloud-model responses that could not be schema-constrained via
 *  native structured output. */
function matchesJsonSchema(value: unknown, rawSchema: unknown): boolean {
  if (!isRecord(rawSchema)) return false;
  const schema = rawSchema;
  if (schema.type === 'object') return matchesObject(value, schema);
  if (schema.type === 'array') return matchesArray(value, schema);
  if (schema.type === 'string') {
    return (
      typeof value === 'string' &&
      (typeof schema.minLength !== 'number' || value.length >= schema.minLength)
    );
  }
  if (schema.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      && (typeof schema.minimum !== 'number' || value >= schema.minimum);
  }
  if (schema.type === 'integer') {
    return Number.isInteger(value)
      && (typeof schema.minimum !== 'number' || (value as number) >= schema.minimum);
  }
  if (schema.type === 'null') return value === null;
  return false;
}

function matchesObject(value: unknown, schema: Record<string, unknown>): boolean {
  if (!isRecord(value) || !isRecord(schema.properties)) return false;
  const properties = schema.properties;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.every((key) => typeof key === 'string' && key in value)) return false;
  if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in properties))) {
    return false;
  }
  return Object.entries(value).every(([key, item]) => {
    const propertySchema = properties[key];
    return propertySchema === undefined || matchesJsonSchema(item, propertySchema);
  });
}

function matchesArray(value: unknown, schema: Record<string, unknown>): boolean {
  if (!Array.isArray(value)) return false;
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
  return schema.items !== undefined && value.every((item) => matchesJsonSchema(item, schema.items));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}