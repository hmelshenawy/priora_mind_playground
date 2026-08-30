import { describe, expect, it } from 'vitest';
import { ConversationMessageService } from '../../../src/modules/conversations/services/conversation-message.service';
import { ConversationContextService } from '../../../src/modules/conversations/services/conversation-context.service';
import { ConversationFollowUpRewriteService } from '../../../src/modules/conversations/services/conversation-follow-up-rewrite.service';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const conversation = {
  id: 'conversation-1',
  userId: 'user-1',
  title: 'Stress tools',
  status: 'ACTIVE',
  createdAt: new Date('2026-08-02T12:00:00Z'),
  updatedAt: new Date('2026-08-02T12:00:00Z'),
  lastMessageAt: null,
};

function makeService() {
  const prisma = makeConversationPrismaStub({ conversation });
  const service = new ConversationMessageService(
    prisma as never,
    { assertEligible: async () => undefined } as never,
    new ConversationContextService(prisma as never),
    new ConversationFollowUpRewriteService(undefined),
  );
  return { service, prisma };
}

describe('conversation static/system routes', () => {
  it('handles greeting and thanks without RAG or LLM dependencies', async () => {
    const { service } = makeService();
    await expect(
      service.send('user-1', conversation.id, { content: 'hello' }),
    ).resolves.toMatchObject({
      assistantMessage: { route: 'STATIC_RESPONSE', status: 'COMPLETED', sources: [] },
    });
    await expect(
      service.send('user-1', conversation.id, { content: 'thanks' }),
    ).resolves.toMatchObject({
      assistantMessage: { route: 'STATIC_RESPONSE', status: 'COMPLETED', sources: [] },
    });
  });

  it('handles help and scope as system commands without RAG or LLM dependencies', async () => {
    const { service } = makeService();
    await expect(
      service.send('user-1', conversation.id, { content: '/help' }),
    ).resolves.toMatchObject({
      assistantMessage: { route: 'SYSTEM_COMMAND', status: 'COMPLETED', sources: [] },
    });
    await expect(
      service.send('user-1', conversation.id, { content: '/scope' }),
    ).resolves.toMatchObject({
      assistantMessage: { route: 'SYSTEM_COMMAND', status: 'COMPLETED', sources: [] },
    });
  });
});