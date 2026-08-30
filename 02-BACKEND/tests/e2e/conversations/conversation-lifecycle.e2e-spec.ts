import { describe, expect, it, vi } from 'vitest';
import { ConversationAccessService } from '../../../src/modules/conversations/services/conversation-access.service';
import { ConversationLifecycleService } from '../../../src/modules/conversations/services/conversation-lifecycle.service';
import { makeConversationPrismaStub } from '../../helpers/fake-conversation-prisma';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
  title: 'Stress tools',
  status: 'ACTIVE',
  createdAt: new Date('2026-08-02T12:00:00Z'),
  updatedAt: new Date('2026-08-02T12:00:00Z'),
  lastMessageAt: null,
};

function makeService() {
  const prisma = makeConversationPrismaStub({ conversation: row });
  const access = new ConversationAccessService(prisma as never);
  const service = new ConversationLifecycleService(access, prisma as never);
  return { service, prisma };
}

describe('conversation lifecycle', () => {
  it('creates, lists, retrieves, archives, unarchives, and deletes owner-scoped conversations', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([row]);
    vi.mocked(prisma.conversationMessage.findMany).mockResolvedValue([]);
    await expect(service.create('user-1', { title: 'Stress tools' })).resolves.toMatchObject({
      conversation: { id: row.id, title: 'Stress tools', status: 'ACTIVE' },
    });
    await expect(
      service.list('user-1', { limit: 25, includeArchived: false }),
    ).resolves.toMatchObject({
      items: [{ id: row.id }],
    });
    await expect(service.get('user-1', row.id, undefined, 25)).resolves.toMatchObject({
      conversation: { id: row.id },
      messages: [],
    });
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce({ ...row, status: 'ARCHIVED' });
    await expect(service.patch('user-1', row.id, { archived: true })).resolves.toMatchObject({
      conversation: { status: 'ARCHIVED' },
    });
    await expect(service.delete('user-1', row.id)).resolves.toBeUndefined();
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({ where: { id: row.id, userId: 'user-1' } });
  });

  it('returns CONVERSATION_NOT_FOUND for missing or foreign conversations', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.conversation.findFirst).mockResolvedValueOnce(null);
    await expect(service.get('user-2', row.id, undefined, 25)).rejects.toMatchObject({
      response: { error: { code: 'CONVERSATION_NOT_FOUND' } },
    });
  });
});