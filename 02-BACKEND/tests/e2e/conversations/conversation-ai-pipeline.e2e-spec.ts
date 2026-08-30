import { describe, expect, it, vi } from 'vitest';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
import { makeConversationStack } from '../../helpers/conversation-service-factory';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const conversation = {
  id: 'conversation-ai-pipeline', userId: 'user-1', title: 'AI pipeline', status: 'ACTIVE',
  createdAt: new Date('2026-08-02T12:00:00Z'), updatedAt: new Date('2026-08-02T12:00:00Z'), lastMessageAt: null,
};

const chunk = {
  chunk_id: 'chunk-1', text: 'CBT examines relationships between thoughts, feelings, and behavior.',
  score: 0.91, source_id: 'source-1', source_title: 'Approved CBT Guide',
  source_type: 'pdf' as const, chunk_index: 1, text_hash: 'hash-1',
};

function makeService(options: {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  ragMessage?: string;
  ragStatus?: 'ok' | 'not_enough_evidence';
} = {}) {
  const provider = new FakeConversationAi(options.ragMessage ? [options.ragMessage] : []);
  const rag = new FakeConversationRagClient();
  rag.nextSearchResult = options.ragStatus === 'not_enough_evidence'
    ? { status: 'not_enough_evidence', correlationId: 'corr', chunks: [] }
    : { status: 'ok', correlationId: 'corr', chunks: [chunk] };
  const prisma = makeConversationPrismaStub({ conversation, history: options.history ?? [] });
  const { service } = makeConversationStack({ prisma, provider, rag });
  return { service, provider, rag, prisma };
}

describe('conversation fixed AI pipeline', () => {
  it('retrieves and answers a knowledge question with citations', async () => {
    const { service, provider, rag } = makeService({ ragMessage: 'What is Cognitive Behavioral Therapy?' });
    const result = await service.send('user-1', conversation.id, { content: 'What is CBT?' });

    expect(rag.searchCalls[0].request).toEqual({ question: 'What is Cognitive Behavioral Therapy?' });
    expect(result.assistantMessage).toMatchObject({ route: null, status: 'COMPLETED' });
    expect(result.assistantMessage.sources).toHaveLength(1);

    const answerInput = JSON.parse(provider.requests.find((request) => request.schemaName === 'conversation_answer')!.input);
    expect(answerInput).toMatchObject({ userMessage: 'What is CBT?', history: [], ragResponse: { status: 'ok' } });
    expect(answerInput.ragMessage).toBeUndefined();
    expect(JSON.stringify(answerInput)).not.toContain('What is Cognitive Behavioral Therapy?');
  });

  it('uses history to generate a retrieval-only ragMessage', async () => {
    const history = [
      { role: 'user' as const, content: 'What is CBT?' },
      { role: 'assistant' as const, content: 'CBT connects thoughts, feelings, and behavior.' },
    ];
    const ragMessage = 'How does Cognitive Behavioral Therapy work?';
    const { service, provider, rag } = makeService({ history, ragMessage });

    await service.send('user-1', conversation.id, { content: 'How does it work?' });

    expect(rag.searchCalls[0].request.question).toBe(ragMessage);
    const ragMessageInput = JSON.parse(provider.requests.find((request) => request.schemaName === 'rag_message')!.input);
    expect(ragMessageInput).toEqual({ history: [...history].reverse(), userMessage: 'How does it work?' });
    const answerInput = JSON.parse(provider.requests.find((request) => request.schemaName === 'conversation_answer')!.input);
    expect(answerInput).toMatchObject({ userMessage: 'How does it work?', history: [...history].reverse(), ragResponse: { status: 'ok' } });
    expect(JSON.stringify(answerInput)).not.toContain(ragMessage);
  });

  it('continues normally without citations when retrieval has no useful evidence', async () => {
    const { service, provider, rag } = makeService({
      ragMessage: 'The user expresses thanks.', ragStatus: 'not_enough_evidence',
    });
    const result = await service.send('user-1', conversation.id, { content: 'Thanks' });

    expect(rag.searchCalls).toHaveLength(1);
    expect(provider.answerCalls).toBe(1);
    expect(result.assistantMessage).toMatchObject({
      route: null, status: 'COMPLETED', content: 'Fixture conversational answer.', sources: [],
    });
  });

  it('fails before retrieval when ragMessage generation fails', async () => {
    const { service, provider, rag, prisma } = makeService();
    vi.spyOn(provider, 'generate').mockRejectedValue(new Error('provider unavailable'));

    await service.send('user-1', conversation.id, { content: 'What is CBT?' });

    expect(rag.searchCalls).toHaveLength(0);
    const assistant = prisma.conversationMessage.create.mock.calls.map((call) => call[0].data).find((row) => row.role === 'assistant');
    expect(assistant).toMatchObject({ route: null, status: 'FAILED', processingStage: 'LLM', failureCode: 'LLM_UNAVAILABLE' });
  });

  it('does not disguise an unexpected RagService programming error as unavailability', async () => {
    const { service, rag } = makeService();
    vi.spyOn(rag, 'search').mockRejectedValue(new Error('unexpected implementation error'));

    await expect(
      service.send('user-1', conversation.id, { content: 'What is CBT?' }),
    ).rejects.toThrow('unexpected implementation error');
  });
});
