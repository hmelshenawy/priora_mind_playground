import { GatewayTimeoutException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { buildAnswerLlmPrompt, buildRagMessageLlmRequest } from './ai-build-prompts';
import { RagService } from '../rag/rag.service';
import type { RagResponse, RetrievedChunk } from '../rag/rag.types';
import type { AiRespondInput, AiResponse, AiSource, AiStage, LlmProvider, LlmRequest, LlmResponse } from './llm.types';

@Injectable()
export class AiService {
  constructor(
    @Inject('LLM_PROVIDER') private readonly provider: LlmProvider | null,
    private readonly rag: RagService,
  ) { }

  generate(request: LlmRequest): Promise<LlmResponse> {
    if (!this.provider) throw new ServiceUnavailableException('LLM provider is disabled');
    return this.provider.generate(request);
  }

  async respond({
    userMessage,
    history,
    messageTraceId, }: AiRespondInput): Promise<AiResponse> {
    const ragMessage = await this.getRagMessage(userMessage, history, messageTraceId);


    const ragResponse = await this.rag.search({ question: ragMessage }, messageTraceId);
    if (ragResponse.status === 'failed') {
      return this.failedResponse('RAG', ragResponse.failureCode, ragMessage);
    }

    const request = buildAnswerLlmPrompt({
      userMessage,
      history,
      ragResponse,
      messageTraceId,
    });
    let llmResponse: LlmResponse;
    try {
      llmResponse = await this.generate(request);
    } catch (error) {
      return this.failedResponse('LLM', llmFailureCode(error), ragMessage);
    }
    return this.buildAiResponse(llmResponse, ragResponse, ragMessage);
  }

  private async getRagMessage(
    userMessage: string,
    history: AiRespondInput['history'],
    messageTraceId: string,
  ): Promise<string> {
    let response: LlmResponse;
    try {
      response = await this.generate(buildRagMessageLlmRequest({
        userMessage,
        history,
        messageTraceId,
      }))


      return response.content.trim() || userMessage
    } catch {
      return userMessage
    }
  }

  private buildAiResponse(response: LlmResponse, ragResponse: RagResponse, ragMessage: string): AiResponse {
    const output = response.content as { content?: unknown; citations?: unknown };
    const content = typeof output.content === 'string' ? output.content.trim() : '';
    if (!content || !Array.isArray(output.citations) || !response.modelId?.trim()) {
      return this.failedResponse('LLM', 'LLM_INVALID_OUTPUT', ragMessage);
    }
    if (isUnsafeOutput(content)) return this.failedResponse('LLM', 'LLM_UNSAFE_OUTPUT', ragMessage);

    const chunks = ragResponse.status === 'ok' ? ragResponse.chunks : [];
    if (chunks.length === 0 && output.citations.length > 0) {
      return this.failedResponse('CITATION_VALIDATION', 'LLM_UNSUPPORTED_CITATION', ragMessage);
    }
    if (chunks.length > 0 && output.citations.length === 0) {
      return this.failedResponse('LLM', 'LLM_INVALID_OUTPUT', ragMessage);
    }

    try {
      return {
        status: 'ok', stage: 'LLM', ragMessage, content,
        citations: mapCitations(output.citations as Citation[], chunks),
        modelId: response.modelId,
        usage: response.usage ?? null,
        latencyMs: response.latencyMs ?? null,
      };
    } catch {
      return this.failedResponse('CITATION_VALIDATION', 'LLM_UNSUPPORTED_CITATION', ragMessage);
    }
  }

  private failedResponse(stage: AiStage, failureCode: string, ragMessage: string | null = null): AiResponse {
    return {
      status: 'failed', stage, ragMessage, content: null, citations: [],
      modelId: null, usage: null, latencyMs: null, failureCode,
    };
  }
}

type Citation = { chunk_id: string; source_id: string; text_hash: string };

export function mapCitations(citations: Citation[], chunks: RetrievedChunk[]): AiSource[] {
  const availableChunks = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
  return citations.map((citation, index) => {
    const chunk = availableChunks.get(citation.chunk_id);
    if (!chunk) throw new Error('UNKNOWN_RAG_CITATION');
    if (chunk.source_id !== citation.source_id || chunk.text_hash !== citation.text_hash) {
      throw new Error('RAG_CITATION_METADATA_MISMATCH');
    }
    return {
      chunkId: chunk.chunk_id, sourceId: chunk.source_id, sourceTitle: chunk.source_title,
      sourceFile: chunk.source_file ?? null, sourceType: chunk.source_type,
      chunkIndex: chunk.chunk_index, score: chunk.score,
      citationPage: chunk.citation_page ?? chunk.page_number ?? null,
      pageStart: chunk.page_start ?? null, pageEnd: chunk.page_end ?? null,
      citationHeading: chunk.citation_heading ?? null,
      citationSection: chunk.citation_section ?? null,
      textHash: chunk.text_hash, displayOrder: index + 1,
    };
  });
}

function llmFailureCode(error: unknown): string {
  if (error instanceof GatewayTimeoutException) return 'LLM_TIMEOUT';
  if (error instanceof ServiceUnavailableException) return 'LLM_DISABLED';
  return 'LLM_UNAVAILABLE';
}

function isUnsafeOutput(content: string): boolean {
  return /\b(diagnose|prescribe|stop medication|increase medication)\b/i.test(content);
}
