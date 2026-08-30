import { describe, expect, it, vi } from 'vitest';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { ConversationMessageService } from '../../../src/modules/conversations/services/conversation-message.service';
import { ConversationContextService } from '../../../src/modules/conversations/services/conversation-context.service';
import { ConversationFollowUpRewriteService } from '../../../src/modules/conversations/services/conversation-follow-up-rewrite.service';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const conversation = {
  id: 'conversation-follow-up',
  userId: 'user-1',
  title: 'Follow up',
  status: 'ACTIVE',
  createdAt: new Date('2026-08-02T12:00:00Z'),
  updatedAt: new Date('2026-08-02T12:00:00Z'),
  lastMessageAt: null,
};

const chunk = {
  chunk_id: 'chunk-follow-1',
  text: 'Paced breathing can support calming.',
  score: 0.91,
  source_id: 'source-follow-1',
  source_title: 'Approved Breathing Guide',
  source_type: 'pdf' as const,
  chunk_index: 1,
  text_hash: 'hash-follow-1',
};

function makeService(overrides: { history?: Array<{ role: 'user' | 'assistant'; content: string }>; ai?: FakeConversationAi } = {}) {
  const rag = new FakeConversationRagClient();
  rag.nextSearchResult = { status: 'ok', correlationId: 'corr-1', chunks: [chunk] };
  const ai = overrides.ai ?? new FakeConversationAi();
  const prisma = makeConversationPrismaStub({ conversation, history: overrides.history ?? [] });
  const service = new ConversationMessageService(
    prisma as never,
    { assertEligible: async () => undefined } as never,
    new ConversationContextService(prisma as never),
    new ConversationFollowUpRewriteService(ai),
    rag,
    ai,
  );
  return { service, rag, ai, prisma };
}

describe('conversation follow-up e2e', () => {
  it('rewrites dependent messages, stores standalone query metadata, and then uses RAG', async () => {
    const { service, rag, ai, prisma } = makeService({ history: [{ role: 'assistant', content: 'paced breathing' }] });
    const result = await service.send('user-1', conversation.id, { content: 'Why?' });
    expect(result.assistantMessage).toMatchObject({ route: 'RAG', status: 'COMPLETED' });
    expect(ai.rewriteCalls).toBe(1);
    expect(rag.searchCalls[0].request.question).toContain('paced breathing');
    const assistantRow = prisma.conversationMessage.create.mock.calls.map((call) => call[0].data).find((d) => d.role === 'assistant');
    expect(assistantRow).toMatchObject({
      route: 'RAG',
      status: 'COMPLETED',
      processingStage: 'LLM',
      standaloneRetrievalQuery: expect.stringContaining('paced breathing'),
    });
  });

  it('does not rewrite clear messages', async () => {
    const { service, ai, rag } = makeService({ history: [{ role: 'assistant', content: 'paced breathing' }] });
    await service.send('user-1', conversation.id, { content: 'What is a grounding exercise for stress?' });
    expect(ai.rewriteCalls).toBe(0);
    expect(rag.searchCalls[0].request.question).toBe('What is a grounding exercise for stress?');
  });

  it('returns insufficient-context clarification without calling RAG', async () => {
    const { service, rag, prisma } = makeService({ history: [] });
    const result = await service.send('user-1', conversation.id, { content: 'Why?' });
    expect(result.assistantMessage).toMatchObject({ route: 'RAG', status: 'COMPLETED' });
    expect(rag.searchCalls).toHaveLength(0);
    const assistantRow = prisma.conversationMessage.create.mock.calls.map((call) => call[0].data).find((d) => d.role === 'assistant');
    expect(assistantRow).toMatchObject({
      route: 'RAG',
      status: 'COMPLETED',
      processingStage: 'FOLLOW_UP_REWRITE',
      reason: 'INSUFFICIENT_CONTEXT',
    });
  });

  it('persists rewrite technical failure without calling RAG', async () => {
    const ai = new FakeConversationAi();
    vi.spyOn(ai, 'generate').mockRejectedValue(new Error('provider down'));
    const { service, rag, prisma } = makeService({ history: [{ role: 'assistant', content: 'paced breathing' }], ai });
    const result = await service.send('user-1', conversation.id, { content: 'Why?' });
    expect(result.assistantMessage).toMatchObject({ route: 'RAG', status: 'FAILED' });
    expect(rag.searchCalls).toHaveLength(0);
    const assistantRow = prisma.conversationMessage.create.mock.calls.map((call) => call[0].data).find((d) => d.role === 'assistant');
    expect(assistantRow).toMatchObject({
      route: 'RAG',
      status: 'FAILED',
      processingStage: 'FOLLOW_UP_REWRITE',
      failureCode: 'FOLLOW_UP_REWRITE_FAILED',
      failureDetail: 'follow_up_rewrite_failed',
    });
  });
});