import { describe, expect, it } from 'vitest';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { ConversationMessageService } from '../../../src/modules/conversations/services/conversation-message.service';
import { ConversationContextService } from '../../../src/modules/conversations/services/conversation-context.service';
import { ConversationFollowUpRewriteService } from '../../../src/modules/conversations/services/conversation-follow-up-rewrite.service';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const conversation = { id: 'c1', userId: 'u1', title: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), lastMessageAt: null };

function makeService(rag: FakeConversationRagClient, ai = new FakeConversationAi()) {
  const prisma = makeConversationPrismaStub({ conversation });
  const service = new ConversationMessageService(
    prisma as never,
    { assertEligible: async () => undefined } as never,
    new ConversationContextService(prisma as never),
    new ConversationFollowUpRewriteService(ai),
    rag,
    ai,
  );
  return { service, ai, prisma };
}

describe('conversation insufficient retrieval e2e', () => {
  it('persists empty or weak retrieval as COMPLETED/RAG with empty sources and no LLM call', async () => {
    const rag = new FakeConversationRagClient();
    rag.nextSearchResult = { status: 'ok', correlationId: 'corr', chunks: [] };
    const { service, ai } = makeService(rag);
    const result = await service.send('u1', 'c1', { content: 'Explain grounding' });
    expect(result.assistantMessage).toMatchObject({ route: 'RAG', status: 'COMPLETED', sources: [] });
    expect(result.assistantMessage.content).toContain("don't have enough grounded information");
    expect(ai.groundedAnswerCalls).toBe(0);
  });

  it('persists RAG technical failures as FAILED/RAG with safe fallback', async () => {
    const rag = new FakeConversationRagClient();
    rag.nextSearchResult = { status: 'timeout', correlationId: 'corr', chunks: [], errorCode: 'RAG_TIMEOUT' };
    const { service, prisma } = makeService(rag);
    const result = await service.send('u1', 'c1', { content: 'Explain grounding' });
    expect(result.assistantMessage).toMatchObject({ route: 'RAG', status: 'FAILED', content: expect.stringContaining('trouble processing') });
    const assistantRow = prisma.conversationMessage.create.mock.calls.map((call) => call[0].data).find((d) => d.role === 'assistant');
    expect(assistantRow).toMatchObject({ route: 'RAG', processingStage: 'RAG', failureCode: 'RAG_TIMEOUT', failureDetail: 'rag_failed' });
  });
});