import { describe, expect, it } from 'vitest';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { ConversationMessageService } from '../../../src/modules/conversations/services/conversation-message.service';
import { ConversationContextService } from '../../../src/modules/conversations/services/conversation-context.service';
import { ConversationFollowUpRewriteService } from '../../../src/modules/conversations/services/conversation-follow-up-rewrite.service';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
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
    const service = new ConversationMessageService(
      prisma as never,
      { assertEligible: async () => undefined } as never,
      new ConversationContextService(prisma as never),
      new ConversationFollowUpRewriteService(ai),
      rag,
      ai,
    );

    const result = await service.send('user-1', conversation.id, { content: 'What is grounding?' });
    expect(result.assistantMessage).toMatchObject({ route: 'RAG', status: 'COMPLETED', content: 'Fixture grounded conversation answer.' });
    expect(result.assistantMessage.sources).toEqual([
      expect.objectContaining({ chunkId: 'chunk-rag-1', sourceId: 'source-rag-1', textHash: 'hash-rag-1' }),
    ]);
    expect(rag.searchCalls[0].request).toMatchObject({ question: 'What is grounding?', limit: 6, score_threshold: 0.44 });
    expect(ai.groundedAnswerCalls).toBe(1);
  });
});