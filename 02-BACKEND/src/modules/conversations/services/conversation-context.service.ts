import { Injectable } from '@nestjs/common';
import type { ConversationHistoryItem } from '../conversation-llm.types';
import { CONVERSATION_LIMITS } from '../constants/conversation.constants';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ConversationContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** Load the recent COMPLETED user/assistant messages (newest first), trimmed
   *  to the character budget, chronologically ordered. */
  async loadRecentHistory(
    userId: string,
    conversationId: string,
    excludeMessageId?: string,
  ): Promise<ConversationHistoryItem[]> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: {
        userId,
        conversationId,
        status: 'COMPLETED',
        role: { in: ['user', 'assistant'] },
        ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CONVERSATION_LIMITS.recentHistoryMessages,
      select: { role: true, content: true, createdAt: true, id: true },
    });
    return this.trimToBudget(
      rows.map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content })),
    );
  }

  trimToBudget(items: ConversationHistoryItem[]): ConversationHistoryItem[] {
    const kept: ConversationHistoryItem[] = [];
    let remaining = CONVERSATION_LIMITS.recentHistoryMaxChars;
    for (const item of items) {
      const content = item.content.trim();
      if (!content) continue;
      if (content.length > remaining) break;
      kept.push({ role: item.role, content });
      remaining -= content.length;
    }
    return kept.reverse();
  }
}