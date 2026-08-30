import { describe, expect, it, vi } from 'vitest';
import { ConversationHistoryService } from '../../../../src/modules/conversations/services/conversation-history.service';

describe('conversation history service', () => {
  it('converts newest-first repository rows into chronological history', () => {
    const service = new ConversationHistoryService({} as never);
    const history = service.trimToBudget(
      [
        { role: 'assistant', content: 'newest' },
        { role: 'user', content: 'middle' },
        { role: 'assistant', content: 'oldest' },
      ],
    );
    expect(history.map((item) => item.content)).toEqual(['oldest', 'middle', 'newest']);
    expect(history.some((item) => item.content.includes('summary'))).toBe(false);
  });

  it('excludes the separately supplied current user message', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ConversationHistoryService({ conversationMessage: { findMany } } as never);
    await service.loadRecentHistory('user-1', 'conversation-1', 'current-message');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'current-message' } }) }),
    );
  });
});
