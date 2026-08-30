import { describe, expect, it } from 'vitest';
import { ConversationArchivedException } from '../../../src/modules/conversations/constants/conversation.errors';
import { makeConversationStack } from '../../helpers/conversation-service-factory';
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

function makeService(status = 'ACTIVE') {
  const prisma = makeConversationPrismaStub({ conversation: { ...conversation, status } });
  const { service } = makeConversationStack({ prisma });
  return { service, prisma };
}

describe('conversation send-message', () => {
  it('persists a user message before the assistant result and touches conversation timestamps', async () => {
    const { service, prisma } = makeService();
    const result = await service.send('user-1', conversation.id, { content: 'Hello' });
    expect(result).toMatchObject({
      conversationId: conversation.id,
      userMessage: { id: 'user-message-1', role: 'user', status: 'COMPLETED' },
      assistantMessage: { id: 'assistant-message-1', role: 'assistant', status: 'COMPLETED' },
    });
    expect(result.assistantMessage).toMatchObject({ route: null, content: 'Fixture conversational answer.' });
    const [userCall, assistantCall] = prisma.conversationMessage.create.mock.calls;
    expect(userCall[0].data.role).toBe('user');
    expect(assistantCall[0].data.role).toBe('assistant');
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: conversation.id, userId: 'user-1' } }),
    );
  });

  it('rejects sends to archived conversations', async () => {
    const { service } = makeService('ARCHIVED');
    await expect(
      service.send('user-1', conversation.id, { content: 'Hello' }),
    ).rejects.toBeInstanceOf(ConversationArchivedException);
  });
});
