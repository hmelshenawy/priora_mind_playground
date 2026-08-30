import { describe, expect, it } from 'vitest';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
import { makeConversationStack } from '../../helpers/conversation-service-factory';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const conversation = {
  id: 'conversation-rag',
  userId: 'user-1',
  title: 'RAG',
  status: 'ACTIVE',
  createdAt: new Date('2026-08-02T12:00:00Z'),
  updatedAt: new Date('2026-08-02T12:00:00Z'),
  lastMessageAt: null,
};

const chunk = {
  chunk_id: 'chunk-rag-1',
  text: 'Grounding helps people orient to the present moment.',
  score: 0.91,
  source_id: 'source-rag-1',
  source_title: 'Approved Grounding Guide',
  source_file: 'grounding.pdf',
  source_type: 'pdf' as const,
  chunk_index: 2,
  page_number: 4,
  page_start: 4,
  page_end: 5,
  citation_page: 4,
  citation_heading: 'Grounding',
  citation_section: 'Basics',
  text_hash: 'hash-rag-1',
};

describe('conversation RAG answer e2e', () => {
  it('returns a completed RAG answer with persisted citation snapshots matching retrieved chunks', async () => {
    const rag = new FakeConversationRagClient();
    rag.nextSearchResult = { status: 'ok', correlationId: 'corr-1', chunks: [chunk] };
    const ai = new FakeConversationAi();
    const prisma = makeConversationPrismaStub({ conversation });
const { service } = makeConversationStack({ prisma, provider: ai, rag });

    const result = await service.send('user-1', conversation.id, { content: 'What is grounding?' });
    expect(result.assistantMessage).toMatchObject({ route: null, status: 'COMPLETED', content: 'Fixture grounded conversation answer.' });
    expect(result.assistantMessage.sources).toEqual([
      expect.objectContaining({ chunkId: 'chunk-rag-1', sourceId: 'source-rag-1', textHash: 'hash-rag-1' }),
    ]);
    expect(rag.searchCalls[0].request).toEqual({ question: 'What is grounding?' });
    expect(ai.answerCalls).toBe(1);
  });
});
