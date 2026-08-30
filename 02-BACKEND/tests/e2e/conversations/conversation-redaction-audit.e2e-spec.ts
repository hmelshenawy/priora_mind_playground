import { describe, expect, it, vi } from 'vitest';
import { BadGatewayException } from '@nestjs/common';
import { FakeConversationAi } from '../../helpers/fake-conversation-ai';
import { FakeConversationRagClient } from '../../helpers/fake-conversation-rag-client';
import { makeConversationStack } from '../../helpers/conversation-service-factory';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

describe('conversation redaction audit', () => {
  it('does not persist raw message, retrieved text, prompts, provider secrets, or stack traces in failure metadata', async () => {
    const rawMessage = 'my private panic details';
    const rawRetrievedText = 'retrieved sensitive chunk text';
    const secret = 'sk-live-secret';
    const rag = new FakeConversationRagClient();
    rag.nextSearchResult = {
      status: 'ok',
      correlationId: 'corr',
      chunks: [{ chunk_id: 'chunk', text: rawRetrievedText, score: 0.9, source_id: 'source', source_title: 'Source', source_type: 'pdf', chunk_index: 1, text_hash: 'hash' }],
    };
    const ai = new FakeConversationAi();
    vi.spyOn(ai, 'generate').mockRejectedValue(new BadGatewayException('Ollama provider is unreachable'));
    const conversation = { id: 'conversation', userId: 'user', title: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), lastMessageAt: null };
    const prisma = makeConversationPrismaStub({ conversation });
    const assistantCreates: Record<string, unknown>[] = [];
    prisma.conversationMessage.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      const { sources, ...rest } = data as { sources?: { create: unknown[] } };
      if (data.role === 'assistant') assistantCreates.push(rest);
      void sources;
      return Promise.resolve({ id: 'assistant', ...rest, sources: [] });
    });
const { service } = makeConversationStack({ prisma, provider: ai, rag });

    await service.send('user', 'conversation', { content: rawMessage });
    const serialized = JSON.stringify(assistantCreates);
    expect(serialized).not.toContain(rawMessage);
    expect(serialized).not.toContain(rawRetrievedText);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('prompt');
    expect(serialized).toContain('LLM_UNAVAILABLE');
  });
});