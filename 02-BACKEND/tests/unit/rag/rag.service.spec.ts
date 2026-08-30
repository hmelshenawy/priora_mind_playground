import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RagService } from '../../../src/modules/rag/rag.service';

const request = { question: 'grounding', limit: 6, score_threshold: 0.44 };
const chunk = {
  chunk_id: 'chunk-1',
  text: 'Grounding text',
  score: 0.9,
  source_id: 'source-1',
  source_title: 'Approved Source',
  source_file: 'source.pdf',
  source_type: 'pdf' as const,
  chunk_index: 1,
  page_number: 2,
  page_start: 2,
  page_end: 3,
  citation_page: 2,
  citation_heading: 'Grounding',
  citation_section: 'Basics',
  text_hash: 'hash-1',
};

describe('Retrieval HTTP boundary', () => {
  beforeEach(() => {
    vi.stubEnv('RAG_BASE_URL', 'https://rag.local/');
    vi.stubEnv('RAG_SERVICE_TOKEN', 'token');
    vi.stubEnv('RAG_TIMEOUT_MS', '25');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends exactly one authenticated POST to /v1/search with unchanged payload and correlation ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [chunk] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new RagService().search(request, 'corr-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://rag.local/v1/search', expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'X-Correlation-Id': 'corr-1',
      },
      body: JSON.stringify(request),
    }));
    expect(result).toEqual({ status: 'ok', correlationId: 'corr-1', chunks: [chunk] });
  });

  it('owns and supplies the configured retrieval policy defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await new RagService().search({ question: 'x' }, 'corr-2');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      question: 'x', limit: 6, score_threshold: 0.44,
    });
  });

  it('returns not_enough_evidence when retrieved chunks are below the configured threshold', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ results: [{ ...chunk, score: 0.43 }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RagService().search({ question: 'x' }, 'corr')).resolves.toEqual({
      status: 'not_enough_evidence', correlationId: 'corr', chunks: [],
    });
  });

  it('removes duplicate and invalid evidence before returning useful chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ results: [chunk, chunk, { ...chunk, chunk_id: '' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RagService().search({ question: 'x' }, 'corr')).resolves.toEqual({
      status: 'ok', correlationId: 'corr', chunks: [chunk],
    });
  });

  it('normalizes missing config and unavailable or unauthorized service without an HTTP retry', async () => {
    vi.stubEnv('RAG_BASE_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new RagService().search(request, 'corr')).resolves.toMatchObject({ status: 'failed', failureCode: 'RAG_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv('RAG_BASE_URL', 'https://rag.local');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(new RagService().search(request, 'corr')).resolves.toMatchObject({ status: 'failed', failureCode: 'RAG_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(new RagService().search(request, 'corr')).resolves.toMatchObject({ status: 'failed', failureCode: 'RAG_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes timeout and performs exactly one request', async () => {
    vi.stubEnv('RAG_TIMEOUT_MS', '1');
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RagService().search(request, 'corr')).resolves.toMatchObject({ status: 'failed', failureCode: 'RAG_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', () => Promise.reject(new SyntaxError('invalid JSON'))],
    ['missing results', () => Promise.resolve({})],
    ['malformed chunk', () => Promise.resolve({ results: [{}] })],
  ])('normalizes %s as a transport failure', async (_label, bodyFactory) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: bodyFactory }));
    const result = await new RagService().search(request, 'corr');
    expect(result.status).toBe('failed');
    expect(result.chunks).toEqual([]);
  });
});
