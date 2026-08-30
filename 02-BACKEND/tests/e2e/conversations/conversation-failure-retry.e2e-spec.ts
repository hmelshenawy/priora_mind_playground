import { describe, expect, it, vi } from 'vitest';
import { GatewayTimeoutException } from '@nestjs/common';
import type { LlmResponse } from '../../../src/modules/ai/llm.types';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { ConversationMessageService } from '../../../src/modules/conversations/services/conversation-message.service';
import { ConversationContextService } from '../../../src/modules/conversations/services/conversation-context.service';
import { ConversationFollowUpRewriteService } from '../../../src/modules/conversations/services/conversation-follow-up-rewrite.service';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const conversation = { id: 'c-fail', userId: 'u1', title: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), lastMessageAt: null };
const chunk = { chunk_id: 'chunk-1', text: 'Grounding text', score: 0.9, source_id: 'source-1', source_title: 'Source', source_type: 'pdf' as const, chunk_index: 1, text_hash: 'hash-1' };

function makeCreates(prisma: ReturnType<typeof makeConversationPrismaStub>) {
  return prisma.conversationMessage.create.mock.calls.map((call) => call[0].data);
}

function makeService(ai = new FakeConversationAi()) {
  const rag = new FakeConversationRagClient();
  rag.nextSearchResult = { status: 'ok', correlationId: 'corr', chunks: [chunk] };
  const prisma = makeConversationPrismaStub({ conversation });
  const service = new ConversationMessageService(
    prisma as never,
    { assertEligible: async () => undefined } as never,
    new ConversationContextService(prisma as never),
    new ConversationFollowUpRewriteService(ai),
    rag,
    ai,
  );
  return { service, prisma, rag };
}

describe('conversation failure and retry e2e', () => {
  it('continues low-risk distress through grounded coaching without assuming self-harm', async () => {
    const ai = new FakeConversationAi();
    const generate = vi.spyOn(ai, 'generate');
    const { service, prisma, rag } = makeService(ai);
    await service.send('u1', 'c-fail', { content: 'I am feeling depressed' });
    expect(rag.searchCalls).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
    const assistantRows = makeCreates(prisma).filter((d) => d.role === 'assistant');
    expect(assistantRows[0]).toMatchObject({ route: 'RAG', status: 'COMPLETED', processingStage: 'LLM' });
  });

  it('persists LLM failures as one safe assistant failure', async () => {
    const ai = new FakeConversationAi();
    vi.spyOn(ai, 'generate').mockRejectedValue(new GatewayTimeoutException('LLM request timed out'));
    const { service, prisma } = makeService(ai);
    const result = await service.send('u1', 'c-fail', { content: 'Explain grounding' });
    expect(result.assistantMessage).toMatchObject({ route: 'RAG', status: 'FAILED' });
    expect(makeCreates(prisma).filter((d) => d.role === 'assistant')[0]).toMatchObject({
      processingStage: 'LLM',
      failureCode: 'LLM_TIMEOUT',
      failureDetail: 'llm_failed',
    });
  });

  it('persists invalid provider output and unsupported citations as failures', async () => {
    const invalidAi = new FakeConversationAi();
    vi.spyOn(invalidAi, 'generate').mockResolvedValue({
      content: { content: '', citations: [] },
      modelId: 'fake',
      latencyMs: 0,
    } as LlmResponse);
    const invalid = makeService(invalidAi);
    await invalid.service.send('u1', 'c-fail', { content: 'Explain grounding' });
    expect(makeCreates(invalid.prisma).filter((d) => d.role === 'assistant')[0]).toMatchObject({
      processingStage: 'LLM',
      failureCode: 'LLM_INVALID_OUTPUT',
    });

    const badCitationAi = new FakeConversationAi();
    vi.spyOn(badCitationAi, 'generate').mockResolvedValue({
      content: { content: 'Answer', citations: [{ chunk_id: 'missing', source_id: 'source-1', text_hash: 'hash-1' }] },
      modelId: 'fake',
      latencyMs: 0,
    } as LlmResponse);
    const badCitation = makeService(badCitationAi);
    await badCitation.service.send('u1', 'c-fail', { content: 'Explain grounding' });
    expect(makeCreates(badCitation.prisma).filter((d) => d.role === 'assistant')[0]).toMatchObject({
      processingStage: 'CITATION_VALIDATION',
      failureCode: 'LLM_UNSUPPORTED_CITATION',
    });
  });
});