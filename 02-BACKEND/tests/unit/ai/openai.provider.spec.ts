import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import type { LlmRequest } from '../../../src/modules/ai/llm.types';
import { OpenAiProvider } from '../../../src/modules/ai/providers/openai.provider';

const schema = {
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

const request: LlmRequest = {
  instructions: 'Use supplied evidence only.',
  input: '{"supportingEvidence":[]}',
  requestId: 'request-123',
  schemaName: 'grounded_answer',
  schema,
};

const valid = {
  content: 'CBT is a structured approach.',
  citations: [{ chunk_id: 'chunk-1', source_id: 'source-1', text_hash: 'hash-1' }],
};

function response(outputText: string, overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: 'resp-1',
      model: 'gpt-5',
      output_text: outputText,
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function provider() {
  return new OpenAiProvider('gpt-5', 'test-secret', 'https://api.openai.com/v1', 100);
}

describe('OpenAI provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the Responses API request with bearer auth and a strict json_schema text format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JSON.stringify(valid)));
    vi.stubGlobal('fetch', fetchMock);
    await provider().generate(request);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-secret');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-5');
    expect(body.instructions).toBe(request.instructions);
    expect(body.input).toBe(request.input);
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'grounded_answer',
      strict: true,
      schema,
    });
  });

  it('resolves the parsed content, server model id, and token usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(JSON.stringify(valid), {
          model: 'gpt-5-mini',
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
      ),
    );
    await expect(provider().generate(request)).resolves.toMatchObject({
      content: valid,
      modelId: 'gpt-5-mini',
      usage: { prompt: 10, completion: 20, total: 30 },
    });
  });

  it('reads the answer text from the nested output array when output_text is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'gpt-5',
            output: [
              { content: [{ type: 'output_text', text: JSON.stringify(valid) }] },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(provider().generate(request)).resolves.toMatchObject({
      content: valid,
      modelId: 'gpt-5',
      usage: undefined,
    });
  });

  it('maps upstream HTTP failures to a 502 BadGatewayException', async () => {
    for (const status of [400, 401, 403, 429, 500]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
      await expect(provider().generate(request)).rejects.toThrow(BadGatewayException);
      await expect(provider().generate(request)).rejects.toMatchObject({ message: 'OpenAI request failed' });
      vi.unstubAllGlobals();
    }
  });

  it('preserves the provider error message from a JSON error body without exposing the raw response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'model overloaded' }, internal: 'raw' }), { status: 503 }),
      ),
    );
    await expect(provider().generate(request)).rejects.toMatchObject({ message: 'model overloaded' });
  });

  it('rejects malformed, empty, or non-JSON answer content with a 502', async () => {
    for (const outputText of ['{not-json', '', '   ']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(outputText)));
      await expect(provider().generate(request)).rejects.toThrow(BadGatewayException);
      await expect(provider().generate(request)).rejects.toMatchObject({ message: 'OpenAI returned a malformed response' });
      vi.unstubAllGlobals();
    }
  });

  it('maps a timeout abort to a 504 while preserving timer cleanup', async () => {
    vi.stubGlobal('fetch', signalRespectingFetch());
    const generate = provider().generate(request);
    await expect(generate).rejects.toThrow(GatewayTimeoutException);
    await expect(generate).rejects.toMatchObject({ message: 'OpenAI request timed out' });
  });

  it('maps a connection failure to a 502 instead of leaking the raw transport error', async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    await expect(provider().generate(request)).rejects.toMatchObject({ message: 'OpenAI provider is unreachable' });
  });

  it('passes Arabic answer content through unchanged', async () => {
    const arabic = { content: 'الجواب المباشر.', citations: [{ chunk_id: 'chunk-1', source_id: 'source-1', text_hash: 'hash-1' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(JSON.stringify(arabic))));
    await expect(provider().generate(request)).resolves.toMatchObject({ content: arabic });
  });

  it('does not fall back to a second request when the provider returns malformed output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('{not-json'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider().generate(request)).rejects.toThrow(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/** fetch mock that rejects with an AbortError when the request signal aborts. */
function signalRespectingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  }));
}