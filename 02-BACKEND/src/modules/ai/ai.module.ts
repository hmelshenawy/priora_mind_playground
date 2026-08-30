import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import type { LlmProvider } from './llm.types';
import { OpenAiProvider } from './providers/openai.provider';
import { OllamaProvider } from './providers/ollama.provider';

/** Resolves the configured LLM provider from environment configuration.
 *  Returns null when the provider is disabled or misconfigured — requests then
 *  see a 503 (`ServiceUnavailableException`) from AiService, and application
 *  startup is never blocked. */


@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'LLM_PROVIDER',
      inject: [ConfigService],
      useFactory: selectProvider,
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}



export function selectProvider(config: ConfigService): LlmProvider | null {
  const provider = config.get<string>('LLM_PROVIDER')?.trim().toLowerCase();
  const model = config.get<string>('LLM_MODEL')?.trim() ?? '';
  const timeoutMs = Number(config.get<string>('LLM_TIMEOUT_MS') ?? 20_000);
  if (!model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  if (provider === 'openai') {
    const apiKey = config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) return null;
    return new OpenAiProvider(
      model,
      apiKey,
      config.get<string>('OPENAI_BASE_URL')?.trim() || 'https://api.openai.com/v1',
      timeoutMs,
    );
  }
  if (provider === 'ollama') {
    return new OllamaProvider(
      model,
      config.get<string>('OLLAMA_BASE_URL')?.trim() || 'http://127.0.0.1:11434',
      timeoutMs,
      config.get<string>('OLLAMA_API_KEY')?.trim(),
    );
  }
  return null;
}