import { describe, expect, it } from 'vitest';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
import { makeConversationStack } from '../../helpers/conversation-service-factory';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const conversation = { id: 'c1', userId: 'u1', title: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), lastMessageAt: null };

function makeService(rag: FakeConversationRagClient, ai = new FakeConversationAi()) {
  const prisma = makeConversationPrismaStub({ conversation });
const { service } = makeConversationStack({ prisma, provider: ai, rag });
  return { service, ai, prisma };
}

describe('conversation insufficient retrieval e2e', () => {
  it('continues to the final LLM when retrieval finds no useful evidence', async () => {
    const rag = new FakeConversationRagClient();
    rag.nextSearchResult = { status: 'not_enough_evidence', correlationId: 'corr', chunks: [] };
    const { service, ai } = makeService(rag);
    const result = await service.send('u1', 'c1', { content: 'Explain grounding' });
    expect(result.assistantMessage).toMatchObject({ route: null, status: 'COMPLETED', sources: [] });
    expect(result.assistantMessage.content).toBe('Fixture conversational answer.');
    expect(ai.answerCalls).toBe(1);
  });

  it('persists RAG technical failures with a safe fallback', async () => {
    const rag = new FakeConversationRagClient();
    rag.nextSearchResult = { status: 'failed', correlationId: 'corr', chunks: [], failureCode: 'RAG_TIMEOUT' };
    const { service, prisma } = makeService(rag);
    const result = await service.send('u1', 'c1', { content: 'Explain grounding' });
    expect(result.assistantMessage).toMatchObject({ route: null, status: 'FAILED', content: expect.stringContaining('trouble processing') });
    const assistantRow = prisma.conversationMessage.create.mock.calls.map((call) => call[0].data).find((d) => d.role === 'assistant');
    expect(assistantRow).toMatchObject({ route: null, processingStage: 'RAG', failureCode: 'RAG_TIMEOUT', failureDetail: 'rag_failed' });
  });
});
