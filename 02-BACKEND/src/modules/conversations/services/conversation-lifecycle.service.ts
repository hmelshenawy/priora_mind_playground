import { Injectable } from '@nestjs/common';
import type {
  CreateConversationDto,
  ListConversationsQueryDto,
  PatchConversationDto,
} from '../dto/conversation.dto';
import { ConversationNotFoundException } from '../constants/conversation.errors';
import { presentConversation, presentConversationMessage } from '../dto/conversation-presenter';
import { ConversationAccessService } from './conversation-access.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Conversation CRUD + message listing for the conversation GET view.
 * All queries are userId-scoped (404 — never 403 — for foreign rows).
 */
@Injectable()
export class ConversationLifecycleService {
  constructor(
    private readonly access: ConversationAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async create(userId: string, input: CreateConversationDto) {
    await this.access.assertEligible(userId);
    const now = new Date();
    const row = await this.prisma.conversation.create({
      data: {
        userId,
        title: input.title ?? null,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        lastMessageAt: null,
      },
    });
    return { conversation: presentConversation(row) };
  }

  async list(userId: string, query: ListConversationsQueryDto) {
    await this.access.assertEligible(userId);
    const where: Record<string, unknown> = { userId };
    if (!query.includeArchived) where.status = 'ACTIVE';
    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit ? (items.at(-1)?.id ?? null) : null;
    return { items: items.map(presentConversation), nextCursor };
  }

  async get(
    userId: string,
    conversationId: string,
    messagesCursor: string | undefined,
    messagesLimit: number,
  ) {
    await this.access.assertEligible(userId);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw new ConversationNotFoundException();
    const rows = await this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: messagesLimit + 1,
      ...(messagesCursor ? { cursor: { id: messagesCursor }, skip: 1 } : {}),
      include: { sources: true },
    });
    const items = rows.slice(0, messagesLimit);
    const nextCursor = rows.length > messagesLimit ? (items.at(-1)?.id ?? null) : null;
    return {
      conversation: presentConversation(conversation),
      messages: items.map(presentConversationMessage),
      nextMessagesCursor: nextCursor,
    };
  }

  async patch(userId: string, conversationId: string, input: PatchConversationDto) {
    await this.access.assertEligible(userId);
    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, userId },
      data: { status: input.archived ? 'ARCHIVED' : 'ACTIVE', updatedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConversationNotFoundException();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    return { conversation: presentConversation(conversation!) };
  }

  async delete(userId: string, conversationId: string): Promise<void> {
    await this.access.assertEligible(userId);
    const deleted = await this.prisma.conversation.deleteMany({
      where: { id: conversationId, userId },
    });
    if (deleted.count !== 1) throw new ConversationNotFoundException();
  }
}