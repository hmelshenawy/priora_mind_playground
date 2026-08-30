import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AiService } from '../../../src/modules/ai/ai.service';
import type { LlmProvider, LlmRequest, LlmResponse } from '../../../src/modules/ai/llm.types';
import { selectProvider } from '../../../src/modules/ai/ai.module';

const request: LlmRequest = {
  instructions: 'Use supplied evidence only.',
  input: '{"supportingEvidence":[]}',
  requestId: 'request-123',
  schemaName: 'grounded_answer',
  schema: { type: 'object' },
};

const response: LlmResponse = {
  content: { content: 'CBT is a structured approach.', citations: [] },
  modelId: 'fake-model',
  latencyMs: 42,
  usage: { prompt: 5, completion: 7, total: 12 },
};

function provider(generate: (request: LlmRequest) => Promise<LlmResponse>): LlmProvider {
  return { generate };
}

describe('AiService.generate', () => {
  it('delegates to the injected provider and returns its response unchanged', async () => {
    const generate = vi.fn().mockResolvedValue(response);
    await expect(new AiService(provider(generate)).generate(request)).resolves.toBe(response);
    expect(generate).toHaveBeenCalledWith(request);
  });

  it('propagates provider exceptions untouched', async () => {
    const failure = new ServiceUnavailableException('provider down');
    await expect(new AiService(provider(() => Promise.reject(failure))).generate(request)).rejects.toBe(failure);
  });

  it('throws a 503 when no provider is configured', () => {
    expect(() => new AiService(null).generate(request)).toThrow(ServiceUnavailableException);
    try {
      new AiService(null).generate(request);
    } catch (error) {
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).message).toBe('LLM provider is disabled');
    }
  });
});

const LLM_ENV_KEYS = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_TIMEOUT_MS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OLLAMA_BASE_URL',
  'OLLAMA_API_KEY',
];

/** ConfigService whose env lookups come straight from process.env. */
function config(env: Record<string, string>): ConfigService {
  for (const key of LLM_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return { get: (key: string) => process.env[key] } as unknown as ConfigService;
}

describe('provider selection from configuration', () => {
  it('builds an OpenAI provider only when the model and API key are both present', () => {
    const configured = selectProvider(config({ LLM_PROVIDER: "OpenAI", LLM_MODEL: "gpt-5", OPENAI_API_KEY: "sk-test" }));
    expect(configured).not.toBeNull();

    expect(selectProvider(config({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-5" }))).toBeNull();
    expect(selectProvider(config({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" }))).toBeNull();
  });

  it('builds an Ollama provider with defaults for the local base URL', () => {
    expect(selectProvider(config({ LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3:1.7b" }))).not.toBeNull();
    expect(selectProvider(config({ LLM_PROVIDER: "ollama" }))).toBeNull();
  });

  it('stays disabled for unknown providers and invalid timeouts, without blocking startup', () => {
    expect(selectProvider(config({ LLM_PROVIDER: "disabled", LLM_MODEL: "gpt-5" }))).toBeNull();
    expect(selectProvider(config({ LLM_PROVIDER: "mystery" }))).toBeNull();
    expect(selectProvider(config({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-5", OPENAI_API_KEY: "sk", LLM_TIMEOUT_MS: "0" }))).toBeNull();
  });
});