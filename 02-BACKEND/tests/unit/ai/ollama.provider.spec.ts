import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import type { LlmRequest } from '../../../src/modules/ai/llm.types';
import { OllamaProvider } from '../../../src/modules/ai/providers/ollama.provider';

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
  schemaName: 'grounded_answer',
  schema,
};

const valid = {
  content: 'CBT is a structured approach.',
  citations: [{ chunk_id: 'chunk-1', source_id: 'source-1', text_hash: 'hash-1' }],
};

function response(content: string) {
  return new Response(JSON.stringify({ model: 'qwen3.5', message: { content } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(model = 'qwen3.5:cloud', baseUrl = 'http://127.0.0.1:11434', timeoutMs = 100) {
  return new OllamaProvider(model, baseUrl, timeoutMs, 'test-key');
}

describe('Ollama local and cloud structured responses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the local Ollama strict structured-output request unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JSON.stringify(valid)));
    vi.stubGlobal('fetch', fetchMock);
    await client('qwen3:1.7b').generate(request);

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(body.format).toEqual(schema);
    expect(body.messages[0].content).toBe(request.instructions);
  });

  it('uses JSON mode for cloud models and states the exact schema in the prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JSON.stringify(valid)));
    vi.stubGlobal('fetch', fetchMock);
    await client().generate(request);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.format).toBe('json');
    expect(body.format).not.toEqual(schema);
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain(JSON.stringify(schema));
    expect(body.messages[0].content).toContain('Return only the root JSON object');
    expect(body.messages[0].content).toContain('do not wrap it in a property named grounded_answer');
  });

  it('accepts valid cloud JSON after exact local schema validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(JSON.stringify(valid))));
    await expect(client().generate(request)).resolves.toMatchObject({
      content: valid,
      modelId: 'qwen3.5',
      usage: undefined,
    });
  });

  it('safely accepts a single complete JSON Markdown fence in cloud mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``)));
    await expect(client().generate(request)).resolves.toMatchObject({ content: valid });
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['missing content', JSON.stringify({ citations: valid.citations })],
    ['missing citations', JSON.stringify({ content: valid.content })],
    ['empty content', JSON.stringify({ ...valid, content: '' })],
    ['empty citations', JSON.stringify({ ...valid, citations: [] })],
    ['extra properties', JSON.stringify({ ...valid, internal: 'not allowed' })],
  ])('rejects %s with a 502', async (_case, content) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(content)));
    await expect(client().generate(request)).rejects.toThrow(BadGatewayException);
  });

  it.each([400, 401, 403, 429, 500])('maps upstream HTTP %s to a 502', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(client().generate(request)).rejects.toThrow(BadGatewayException);
  });

  it('supports both documented direct-cloud base URL forms', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JSON.stringify(valid)));
    vi.stubGlobal('fetch', fetchMock);
    await client('qwen3.5:cloud', 'https://ollama.com/api').generate(request);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ollama.com/api/chat');
  });
});

const ragMessageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ragMessage'],
  properties: {
    ragMessage: { type: 'string', minLength: 1 },
  },
};

const ragMessageRequest: LlmRequest = {
  instructions:
    'Create a self-contained retrieval message. Return JSON matching the required schema. Never answer the user message itself.',
  input: '{"history":[],"userMessage":"How do I stop it before meetings?"}',
  schemaName: 'rag_message',
  schema: ragMessageSchema,
};

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

describe('Ollama transport failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('1. generates a retrieval message through Ollama Cloud JSON mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(JSON.stringify({ ragMessage: 'How does Cognitive Behavioral Therapy help with work anxiety before meetings?' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await client('qwen3.5:cloud', 'http://127.0.0.1:11434', 5000).generate(ragMessageRequest);
    expect(result.content).toEqual({ ragMessage: 'How does Cognitive Behavioral Therapy help with work anxiety before meetings?' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('qwen3.5:cloud');
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.format).toBe('json');
  });

  it('2. rejects an HTTP 200 response carrying an Ollama error object with the provider message in a 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'model load failed' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    await expect(client().generate(ragMessageRequest)).rejects.toThrow(BadGatewayException);
    await expect(client().generate(ragMessageRequest)).rejects.toMatchObject({ message: 'model load failed' });
  });

  it('3. maps a timeout abort to a 504', async () => {
    vi.stubGlobal('fetch', signalRespectingFetch());
    const promise = client('qwen3.5:cloud', 'http://127.0.0.1:11434', 30).generate(ragMessageRequest);
    await expect(promise).rejects.toThrow(GatewayTimeoutException);
    await expect(promise).rejects.toMatchObject({ message: 'Ollama request timed out' });
  });

  it('3b. maps an undici-wrapped abort (TypeError cause AbortError) to a 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new TypeError('fetch failed');
          err.cause = { name: 'AbortError' };
          reject(err);
        });
      })),
    );
    const promise = client('qwen3.5:cloud', 'http://127.0.0.1:11434', 30).generate(ragMessageRequest);
    await expect(promise).rejects.toThrow(GatewayTimeoutException);
  });

  it('4. maps a network connection failure to a 502 instead of leaking the raw transport error', async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    await expect(client().generate(ragMessageRequest)).rejects.toThrow(BadGatewayException);
    await expect(client().generate(ragMessageRequest)).rejects.toMatchObject({ message: 'Ollama provider is unreachable' });
  });

  it.each([500, 502, 503])('5. maps upstream HTTP %i to a 502', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(client().generate(ragMessageRequest)).rejects.toThrow(BadGatewayException);
  });

  it('6. clears the timeout timer after a successful response', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(JSON.stringify(valid))));
    await client('qwen3.5:cloud', 'http://127.0.0.1:11434', 5000).generate(request);
    expect(setTimeoutSpy).toHaveBeenCalled();
    const timerId = setTimeoutSpy.mock.results.at(-1)?.value;
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
  });

  it('7. does not share AbortController state between concurrent requests', async () => {
    const fetchMock = vi
      .fn()
      // A: respects the signal, will be aborted by its own short timer.
      .mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }))
      // B: resolves immediately and must remain unaffected by A's abort.
      .mockResolvedValueOnce(response(JSON.stringify({ ragMessage: 'how to manage work anxiety' })));
    vi.stubGlobal('fetch', fetchMock);
    const c = client('qwen3.5:cloud', 'http://127.0.0.1:11434', 30);
    const aPromise = c.generate(ragMessageRequest);
    const bPromise = c.generate(ragMessageRequest);
    await expect(bPromise).resolves.toMatchObject({ content: { ragMessage: 'how to manage work anxiety' } });
    await expect(aPromise).rejects.toThrow(GatewayTimeoutException);
  });
});
