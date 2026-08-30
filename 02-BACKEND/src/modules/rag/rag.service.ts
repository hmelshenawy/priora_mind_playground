import { Injectable } from '@nestjs/common';
import type { RetrievedChunk, RetrievalSearchRequest, RetrievalSearchResult } from './rag.types';

@Injectable()
export class RagService {
  private readonly baseUrl = process.env.RAG_BASE_URL ?? '';
  private readonly serviceToken = process.env.RAG_SERVICE_TOKEN ?? '';
  private readonly timeoutMs = Number(process.env.RAG_TIMEOUT_MS ?? '5000');
  private readonly scoreThreshold = Number(process.env.RAG_SCORE_THRESHOLD ?? '0.44');
  private readonly searchLimit = 6;
  private readonly maxContextChars = 8000;

  async search(request: RetrievalSearchRequest, correlationId: string): Promise<RetrievalSearchResult> {
    if (!this.baseUrl || !this.serviceToken) return this.unavailable(correlationId);
    const searchRequest = {
      ...request,
      limit: request.limit ?? this.searchLimit,
      score_threshold: request.score_threshold ?? this.scoreThreshold,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify(searchRequest),
        signal: controller.signal,
      });
      if (response.status === 401) return this.unavailable(correlationId);
      if (!response.ok) return this.unavailable(correlationId);
      const body = (await response.json()) as { results?: unknown };

      if (!Array.isArray(body.results)) return this.invalid(correlationId);
      const rawChunks = body.results.filter(this.isChunk);
      if (rawChunks.length !== body.results.length) return this.invalid(correlationId);
      const chunks = this.selectUsefulChunks(rawChunks, searchRequest.score_threshold, searchRequest.limit);
      return chunks.length > 0
        ? { status: 'ok', correlationId, chunks }
        : { status: 'not_enough_evidence', correlationId, chunks: [] };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { status: 'failed', correlationId, chunks: [], failureCode: 'RAG_TIMEOUT' };
      }
      return this.unavailable(correlationId);
    } finally {
      clearTimeout(timer);
    }
  }

  private selectUsefulChunks(chunks: RetrievedChunk[], threshold: number, limit: number): RetrievedChunk[] {
    const selected: RetrievedChunk[] = [];
    const seen = new Set<string>();
    let remainingChars = this.maxContextChars;
    for (const chunk of chunks) {
      if (!chunk.chunk_id.trim() || !chunk.text.trim() || !chunk.source_id.trim()
        || !chunk.source_title.trim() || !chunk.text_hash.trim()) continue;
      if (!Number.isFinite(chunk.score) || !Number.isInteger(chunk.chunk_index)) continue;
      if (chunk.score < threshold || seen.has(chunk.chunk_id)) continue;
      const length = chunk.text.trim().length;
      if (length > remainingChars) continue;
      selected.push(chunk);
      seen.add(chunk.chunk_id);
      remainingChars -= length;
      if (selected.length >= limit) break;
    }
    return selected;
  }

  private isChunk(value: unknown): value is RetrievedChunk {
    const chunk = value as RetrievedChunk;
    return Boolean(
      chunk &&
        typeof chunk.chunk_id === 'string' &&
        typeof chunk.text === 'string' &&
        typeof chunk.score === 'number' &&
        typeof chunk.source_id === 'string' &&
        typeof chunk.source_title === 'string' &&
        (chunk.source_type === 'pdf' || chunk.source_type === 'markdown') &&
        typeof chunk.chunk_index === 'number' &&
        typeof chunk.text_hash === 'string',
    );
  }

  private unavailable(correlationId: string): RetrievalSearchResult {
    return { status: 'failed', correlationId, chunks: [], failureCode: 'RAG_UNAVAILABLE' };
  }

  private invalid(correlationId: string): RetrievalSearchResult {
    return { status: 'failed', correlationId, chunks: [], failureCode: 'RAG_INVALID_RESPONSE' };
  }
}
