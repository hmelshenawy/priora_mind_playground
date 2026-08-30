/* Live verification: drives the real AiService against Ollama Cloud
 * for BOTH the FOLLOW_UP_REWRITE and the LLM (grounded answer) stages, several
 * times with fresh correlation IDs. This exercises follow-up handling end-to-end
 * at the AI-transport level (rewrite -> grounded RAG answer -> final assistant
 * message) without touching auth/DB.
 *
 * Logs ONLY redaction-safe metadata (no prompts, user content, response bodies,
 * API keys, or stack traces). Run: npx ts-node scripts/live-verify-followup.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../src/modules/ai/ai.service';
import { FOLLOW_UP_REWRITE_SCHEMA } from '../src/modules/conversations/services/conversation-follow-up-rewrite.service';
import { buildGroundedLlmRequest } from '../src/modules/conversations/utils/conversation-prompt';
import type { LlmRequest } from '../src/modules/ai/llm.types';
import type { RetrievedChunk } from '../src/modules/rag/rag.types';

// Load .env into process.env (minimal parser, no external dep).
const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const config = new ConfigService();
// Matches AiModule's provider selection for a live Ollama Cloud config.
const adapter = new AiService(
  config.get<string>('LLM_PROVIDER') === 'ollama' && config.get<string>('LLM_MODEL')
    ? {
        generate: (request: LlmRequest) =>
          import('../src/modules/ai/providers/ollama.provider').then(({ OllamaProvider }) =>
            new OllamaProvider(
              config.get<string>('LLM_MODEL')!,
              config.get<string>('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434',
              Number(config.get<string>('LLM_TIMEOUT_MS') ?? 20_000),
              config.get<string>('OLLAMA_API_KEY'),
            ).generate(request),
          ),
      }
    : null,
  config,
);

function followUpRewriteRequest(correlationId: string, recentHistory: { role: 'user' | 'assistant'; content: string }[], currentMessage: string): LlmRequest {
  return {
    requestId: correlationId,
    instructions:
      'Rewrite the current message as one standalone retrieval query using only the supplied conversation history. Return JSON matching the required schema. Do not answer the question.',
    input: JSON.stringify({ recentHistory, currentMessage }),
    schemaName: 'follow_up_rewrite',
    schema: FOLLOW_UP_REWRITE_SCHEMA,
  };
}

const cases: { correlationId: string; currentMessage: string; chunk: RetrievedChunk }[] = [
  {
    correlationId: 'live-fur-001',
    currentMessage: 'How do I stop anxiety before meetings?',
    chunk: {
      chunk_id: 'chunk-live-1', score: 0.91, source_id: 'source-live-1', source_title: 'Grounding',
      source_type: 'markdown', chunk_index: 0, text_hash: 'hash-live-1',
      text: 'Before meetings, try a brief grounding exercise: name five objects in the room, then take three slow breaths to lower activation.',
    },
  },
  {
    correlationId: 'live-fur-002',
    currentMessage: 'What can I do about sleep problems lately?',
    chunk: {
      chunk_id: 'chunk-live-2', score: 0.88, source_id: 'source-live-2', source_title: 'Sleep hygiene',
      source_type: 'markdown', chunk_index: 0, text_hash: 'hash-live-2',
      text: 'Keep a consistent wake time, limit caffeine after midday, and wind down screen use an hour before bed.',
    },
  },
  {
    correlationId: 'live-fur-003',
    currentMessage: 'Help me manage stress around deadlines.',
    chunk: {
      chunk_id: 'chunk-live-3', score: 0.9, source_id: 'source-live-3', source_title: 'Stress management',
      source_type: 'markdown', chunk_index: 0, text_hash: 'hash-live-3',
      text: 'Break deadlines into small next steps and schedule each on a calendar; practice box breathing when tension rises.',
    },
  },
];

const recentHistory = [
  { role: 'user' as const, content: 'I have been feeling anxious at work' },
  { role: 'assistant' as const, content: 'Tell me more about what triggers the anxiety.' },
];

(async () => {
  let rewriteOk = 0;
  let groundedOk = 0;
  let fail = 0;
  for (const c of cases) {
    // Stage 1: FOLLOW_UP_REWRITE through real Ollama Cloud JSON mode.
    let standalone = '';
    try {
      const res = await adapter.generate(followUpRewriteRequest(c.correlationId, recentHistory, c.currentMessage));
      const output = res.content as { standaloneRetrievalQuery?: string };
      if (typeof output.standaloneRetrievalQuery !== 'string' || !output.standaloneRetrievalQuery.trim()) {
        throw new Error('LLM_INVALID_OUTPUT');
      }
      rewriteOk++;
      standalone = output.standaloneRetrievalQuery;
      console.log(JSON.stringify({
        stage: 'FOLLOW_UP_REWRITE', status: 'ok', correlationId: c.correlationId,
        latencyMs: res.latencyMs, modelId: res.modelId, queryLength: standalone.length,
      }));
    } catch (error: unknown) {
      fail++;
      const e = error as { code?: string; diagnostics?: Record<string, unknown> };
      console.log(JSON.stringify({ stage: 'FOLLOW_UP_REWRITE', status: 'fail', correlationId: c.correlationId, code: e.code, diagnostics: e.diagnostics }));
      continue;
    }

    // Stage 2: LLM grounded answer (RAG continues -> final assistant message).
    try {
      const res = await adapter.generate(buildGroundedLlmRequest({
        productInstructions: ['Answer as a supportive coaching assistant using only supplied evidence.'],
        recentHistory,
        currentMessage: c.currentMessage,
        standaloneRetrievalQuery: standalone,
        chunks: [c.chunk],
      }, c.correlationId));
      const output = res.content as { content?: string; citations?: Array<{ chunk_id: string }> };
      if (typeof output.content !== 'string' || !Array.isArray(output.citations)) {
        throw new Error('LLM_INVALID_OUTPUT');
      }
      groundedOk++;
      const citationIds = output.citations.map((cit) => cit.chunk_id);
      const citationsValid = citationIds.every((id) => id === c.chunk.chunk_id);
      console.log(JSON.stringify({
        stage: 'LLM_GROUNDED_ANSWER', status: 'ok', correlationId: c.correlationId,
        latencyMs: res.latencyMs, modelId: res.modelId,
        contentLength: output.content.length, citationCount: output.citations.length, citationsValid,
      }));
    } catch (error: unknown) {
      fail++;
      const e = error as { code?: string; diagnostics?: Record<string, unknown> };
      console.log(JSON.stringify({ stage: 'LLM_GROUNDED_ANSWER', status: 'fail', correlationId: c.correlationId, code: e.code, diagnostics: e.diagnostics }));
    }
  }
  console.log(JSON.stringify({ summary: { rewriteOk, groundedOk, fail, total: cases.length } }));
  process.exit(fail === 0 ? 0 : 1);
})();