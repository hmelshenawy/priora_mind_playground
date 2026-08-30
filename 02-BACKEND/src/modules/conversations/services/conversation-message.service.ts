import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import type { AiResponse } from '../../ai/llm.types';
import type { SendMessageDto } from '../dto/conversation.dto';
import { ConversationAccessService } from './conversation-access.service';
import {
  ConversationArchivedException,
  ConversationNotFoundException,
} from '../constants/conversation.errors';
import { presentConversationMessage, type AssistantSourceRowLike, type ConversationMessageRowLike } from '../dto/conversation-presenter';
import { ConversationHistoryService } from './conversation-history.service';
import { CONVERSATION_FALLBACKS } from '../constants/conversation.constants';
import { normalizeFailureCode, safeFailureDetail } from '../utils/conversation-failure-metadata';
import { PrismaService } from '../../../prisma/prisma.service';

/** Resolved message-processing context shared by the persistence helpers. */
interface SendContext {
  userId: string;
  conversationId: string;
  userMessageId: string;
  userMessage: ConversationMessageRowLike;
}

/** Assistant-message persistence options (citations, provenance, rag message trace). */
interface AssistantMessageOptions {
  /** Actual retrieval message, mapped to the legacy DB column. */
  ragMessage?: string | null;
  provider?: string | null;
  modelId?: string | null;
  tokenUsage?: Record<string, unknown> | null;
  latencyMs?: number | null;
  sources?: AssistantSourceRowLike[];
}

/** The presented send response returned to the controller. */
type SendResponse = {
  conversationId: string;
  userMessage: ReturnType<typeof presentConversationMessage>;
  assistantMessage: ReturnType<typeof presentConversationMessage>;
};

@Injectable()
export class ConversationMessageService {
  private readonly logger = new Logger(ConversationMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ConversationAccessService,
    private readonly history: ConversationHistoryService,
    private readonly ai: AiService,
  ) { }

  async send(userId: string, conversationId: string, input: SendMessageDto) {
    await this.access.assertEligible(userId);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw new ConversationNotFoundException();
    if (conversation.status === 'ARCHIVED') throw new ConversationArchivedException();

    const now = new Date();
    const userMessageRow = await this.createUserMessage(userId, conversationId, input.content, now);
    const ctx: SendContext = { userId, conversationId, userMessage: userMessageRow, userMessageId: userMessageRow.id };

    const messageTraceId = `conversation-${conversationId}-${userMessageRow.id}`;
    const userMessage = input.content.trim();
    const history = await this.history.loadRecentHistory(userId, conversationId, userMessageRow.id);

    const aiResponse = await this.ai.respond({ userMessage, history, messageTraceId });

    return this.saveAssistantResponse(ctx, aiResponse);
  }

  /** Persists the generated response or a safe technical failure. */
  private async saveAssistantResponse(ctx: SendContext, aiResponse: AiResponse): Promise<SendResponse> {
    if (aiResponse.status === 'failed') {
      const stage = aiResponse.stage;
      const safeCode = normalizeFailureCode(aiResponse.failureCode ?? null, 'ORCHESTRATION_FAILED');
      this.logger.warn({ event: 'conversation_assistant_failed', conversationId: ctx.conversationId, userMessageId: ctx.userMessageId, processingStage: stage, failureCode: safeCode });
      return this.persistAssistant(ctx, CONVERSATION_FALLBACKS.technical, 'FAILED', stage, safeCode, safeFailureDetail(stage), {});
    }

    return this.persistAssistant(ctx, aiResponse.content!, 'COMPLETED', aiResponse.stage, null, null, {
      ragMessage: aiResponse.ragMessage,
      provider: 'conversation-ai',
      modelId: aiResponse.modelId,
      tokenUsage: aiResponse.usage ?? null,
      latencyMs: aiResponse.latencyMs ?? null,
      sources: aiResponse.citations,
    });
  }

  /** Persist the user's message verbatim with status COMPLETED. */
  private async createUserMessage(userId: string, conversationId: string, content: string, now: Date) {
    return this.prisma.conversationMessage.create({
      data: {
        conversationId,
        userId,
        role: 'user',
        content,
        route: null,
        status: 'COMPLETED',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      },
      include: { sources: true },
    });
  }

  /** Persists the assistant reply (COMPLETED or FAILED) plus citations/provenance,
   *  updates conversation activity timestamps, and returns the presented response. */
  private async persistAssistant(
    ctx: SendContext,
    content: string,
    status: 'COMPLETED' | 'FAILED',
    processingStage: string | null,
    failureCode: string | null,
    failureDetail: string | null,
    options: AssistantMessageOptions,
  ): Promise<SendResponse> {
    const now = new Date();
    const assistantMessage = await this.prisma.conversationMessage.create({
      data: {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        role: 'assistant',
        content,
        route: null,
        status,
        respondsToMessageId: ctx.userMessageId,
        processingStage,
        reason: null,
        failureCode,
        failureDetail,
        standaloneRetrievalQuery: options.ragMessage ?? null,
        provider: options.provider ?? null,
        modelId: options.modelId ?? null,
        tokenUsage: (options.tokenUsage ?? null) as never,
        latencyMs: options.latencyMs ?? null,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        ...(options.sources?.length
          ? {
            sources: {
              create: options.sources.map((source) => ({
                chunkId: source.chunkId,
                sourceId: source.sourceId,
                sourceTitle: source.sourceTitle,
                sourceFile: source.sourceFile ?? null,
                sourceType: source.sourceType,
                chunkIndex: source.chunkIndex,
                score: source.score,
                citationPage: source.citationPage ?? null,
                pageStart: source.pageStart ?? null,
                pageEnd: source.pageEnd ?? null,
                citationHeading: source.citationHeading ?? null,
                citationSection: source.citationSection ?? null,
                textHash: source.textHash,
                displayOrder: source.displayOrder,
              })),
            },
          }
          : {}),
      },
      include: { sources: true },
    });
    await this.prisma.conversation.updateMany({
      where: { id: ctx.conversationId, userId: ctx.userId },
      data: { updatedAt: now, lastMessageAt: now },
    });
    return {
      conversationId: ctx.conversationId,
      userMessage: presentConversationMessage(ctx.userMessage),
      assistantMessage: presentConversationMessage(assistantMessage),
    };
  }
}
