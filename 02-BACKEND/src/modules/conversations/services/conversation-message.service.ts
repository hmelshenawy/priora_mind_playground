import { GatewayTimeoutException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import type { GroundedAnswerRequest, GroundedAnswerResult, ConversationHistoryItem } from '../conversation-llm.types';
import type { SendMessageDto } from '../dto/conversation.dto';
import { ConversationAccessService } from './conversation-access.service';
import {
  ConversationArchivedException,
  ConversationNotFoundException,
} from '../constants/conversation.errors';
import { presentConversationMessage, type AssistantSourceRowLike, type ConversationMessageRowLike } from '../dto/conversation-presenter';
import { ConversationContextService } from './conversation-context.service';
import { ConversationFollowUpRewriteService } from './conversation-follow-up-rewrite.service';
import { CONVERSATION_FALLBACKS, CONVERSATION_LIMITS } from '../constants/conversation.constants';
import { isFollowUp } from '../utils/conversation-follow-up-detector';
import { detectStaticOrSystemResponse } from '../utils/conversation-static-responses';
import { mapCitations } from '../utils/conversation-citation-mapper';
import { buildGroundedPrompt, buildGroundedLlmRequest } from '../utils/conversation-prompt';
import { selectSufficientChunks } from '../utils/conversation-grounding';
import { RagService } from '../../rag/rag.service';
import type { RetrievalSearchResult } from '../../rag/rag.types';
import type { RetrievedChunk } from '../../rag/rag.types';
import { normalizeFailureCode, safeFailureDetail } from '../utils/conversation-failure-metadata';
import { PrismaService } from '../../../prisma/prisma.service';

/** Resolved message-processing context shared by the persistence helpers. */
interface SendContext {
  userId: string;
  conversationId: string;
  userMessageId: string;
  userMessage: ConversationMessageRowLike;
}

/** Assistant-message persistence options (citations, provenance, follow-up trace). */
interface AssistantMessageOptions {
  reason?: string | null;
  standaloneRetrievalQuery?: string | null;
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
    private readonly context: ConversationContextService,
    private readonly followUpRewrite: ConversationFollowUpRewriteService,
    private readonly rag: RagService,
    private readonly ai: AiService,
  ) {}

  async send(userId: string, conversationId: string, input: SendMessageDto) {
    await this.access.assertEligible(userId);
    console.log("Sending Message!!",input.content)
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw new ConversationNotFoundException();
    if (conversation.status === 'ARCHIVED') throw new ConversationArchivedException();

    const now = new Date();
    const userMessage = await this.createUserMessage(userId, conversationId, input.content, now);
    const ctx: SendContext = { userId, conversationId, userMessage, userMessageId: userMessage.id };

    const staticDecision = detectStaticOrSystemResponse(input.content);
    if (staticDecision) {
      return this.persistAssistant(ctx, staticDecision.content, staticDecision.route, 'COMPLETED', null, null, null, {});
    }

    const correlationId = `conversation-${conversationId}-${userMessage.id}`;
    const recentHistory = await this.context.loadRecentHistory(userId, conversationId, userMessage.id);
    const resolved = await this.resolveStandaloneQuery(ctx, correlationId, recentHistory, input.content);
    if ('redirect' in resolved) return resolved.redirect;
    const standaloneRetrievalQuery = resolved.query;
    const isFollowUpMessage = resolved.isFollowUp;
    console.log("hnaaa")
    console.log('rag:', !!this.rag);
    console.log('ai:', !!this.ai);
    if (!this.rag || !this.ai) {
      return this.persistAssistant(ctx, CONVERSATION_FALLBACKS.technical, 'RAG', 'FAILED', 'RAG',
        !this.rag ? 'RAG_UNAVAILABLE' : 'LLM_UNAVAILABLE',
        !this.rag ? 'rag_client_unavailable' : 'llm_client_unavailable',
        { standaloneRetrievalQuery: isFollowUpMessage ? standaloneRetrievalQuery : null });
    }
    console.log("hnaaa1")
    

    const ragResult = await this.searchRagSafely(standaloneRetrievalQuery, correlationId);
    if (ragResult.status === 'timeout' || ragResult.status === 'unavailable' || ragResult.status === 'invalid_response') {
      return this.persistFailureAndReturn(ctx, 'RAG', this.ragFailureCode(ragResult.status, ragResult.errorCode));
    }
    const chunks = selectSufficientChunks(ragResult);
    if (chunks.length === 0) {
      return this.persistAssistant(ctx, CONVERSATION_FALLBACKS.insufficientEvidence, 'RAG', 'COMPLETED', 'RAG', null, null,
        { reason: 'INSUFFICIENT_GROUNDING', standaloneRetrievalQuery: isFollowUpMessage ? standaloneRetrievalQuery : null });
    }
    console.log("hnaaa3")
    const prompt = buildGroundedPrompt({ recentHistory, currentMessage: input.content, standaloneRetrievalQuery, chunks });
    const answer = await this.generateAnswerSafely({ correlationId, ...prompt });
    if ('failureCode' in answer) return this.persistFailureAndReturn(ctx, 'LLM', answer.failureCode);
    const sources = this.mapCitationsSafely(answer, chunks);
    if ('failureCode' in sources) return this.persistFailureAndReturn(ctx, 'CITATION_VALIDATION', sources.failureCode);
    return this.persistAssistant(ctx, answer.content, 'RAG', 'COMPLETED', 'LLM', null, null, {
      standaloneRetrievalQuery: isFollowUpMessage ? standaloneRetrievalQuery : null,
      provider: 'conversation-ai',
      modelId: answer.modelId,
      tokenUsage: answer.usage ?? null,
      latencyMs: answer.latencyMs ?? null,
      sources,
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

  /** Follow-up detection and standalone-query resolution. Returns either a redirect
   *  response (insufficient context / rewrite failure) or the resolved retrieval query
   *  plus whether the message was treated as a follow-up. */
  private async resolveStandaloneQuery(
    ctx: SendContext,
    correlationId: string,
    recentHistory: ConversationHistoryItem[],
    content: string,
  ): Promise<{ redirect: SendResponse } | { query: string; isFollowUp: boolean }> {
    if (!isFollowUp(content)) {
      return { query: content.trim(), isFollowUp: false };
    }
    const rewrite = await this.followUpRewrite.rewrite({ correlationId, recentHistory, currentMessage: content });
    if (rewrite.status === 'insufficient_context') {
      return { redirect: await this.persistAssistant(ctx, CONVERSATION_FALLBACKS.insufficientContext, 'RAG', 'COMPLETED', 'FOLLOW_UP_REWRITE', null, null, { reason: 'INSUFFICIENT_CONTEXT' }) };
    }
    if (rewrite.status === 'failed') {
      return { redirect: await this.persistAssistant(ctx, CONVERSATION_FALLBACKS.technical, 'RAG', 'FAILED', 'FOLLOW_UP_REWRITE', rewrite.failureCode, 'follow_up_rewrite_failed', {}) };
    }
    return { query: rewrite.result.standaloneRetrievalQuery.trim(), isFollowUp: true };
  }

  /** Persists the assistant reply (COMPLETED or FAILED) plus citations/provenance,
   *  updates conversation activity timestamps, and returns the presented response. */
  private async persistAssistant(
    ctx: SendContext,
    content: string,
    route: 'SYSTEM_COMMAND' | 'STATIC_RESPONSE' | 'RAG',
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
        route,
        status,
        respondsToMessageId: ctx.userMessageId,
        processingStage,
        reason: options.reason ?? null,
        failureCode,
        failureDetail,
        standaloneRetrievalQuery: options.standaloneRetrievalQuery ?? null,
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

  /** Persists a FAILED assistant message with fallback copy and safe error codes. */
  private async persistFailure(ctx: SendContext, processingStage: string, failureCode: string): Promise<SendResponse> {
    const safeCode = normalizeFailureCode(failureCode, 'ORCHESTRATION_FAILED');
    this.logger.warn({ event: 'conversation_assistant_failed', conversationId: ctx.conversationId, userMessageId: ctx.userMessageId, processingStage, failureCode: safeCode });
    return this.persistAssistant(ctx, CONVERSATION_FALLBACKS.technical, 'RAG', 'FAILED', processingStage, safeCode, safeFailureDetail(processingStage), {});
  }

  private async persistFailureAndReturn(ctx: SendContext, processingStage: string, failureCode: string): Promise<SendResponse> {
    return this.persistFailure(ctx, processingStage, failureCode);
  }

  private async searchRagSafely(question: string, correlationId: string): Promise<RetrievalSearchResult> {
    try {
      return await this.rag!.search(
        { question, limit: CONVERSATION_LIMITS.ragLimit, score_threshold: CONVERSATION_LIMITS.ragScoreThreshold },
        correlationId,
      );
    } catch {
      return { status: 'unavailable', correlationId, chunks: [], errorCode: 'RAG_UNAVAILABLE' };
    }
  }

  private ragFailureCode(status: string, errorCode?: string): string {
    if (status === 'timeout') return 'RAG_TIMEOUT';
    if (status === 'invalid_response') return 'RAG_INVALID_RESPONSE';
    return normalizeFailureCode(errorCode, 'RAG_UNAVAILABLE');
  }

  /** Calls the configured LLM with the grounded request and validates the
   *  parsed output into a GroundedAnswerResult. */
  private async generateAnswerSafely(
    request: GroundedAnswerRequest,
  ): Promise<GroundedAnswerResult | { failureCode: string }> {
    try {
      const answer = await this.ai!.generate(buildGroundedLlmRequest(request, request.correlationId));
      const output = answer.content as Partial<GroundedAnswerResult>;
      if (
        typeof output.content !== 'string' ||
        !output.content.trim() ||
        !Array.isArray(output.citations) ||
        output.citations.length === 0 ||
        !answer.modelId?.trim()
      ) {
        return { failureCode: 'LLM_INVALID_OUTPUT' };
      }
      if (/\b(diagnose|prescribe|stop medication|increase medication)\b/i.test(output.content)) {
        return { failureCode: 'LLM_UNSAFE_OUTPUT' };
      }
      return {
        content: output.content,
        citations: output.citations,
        usage: answer.usage,
        latencyMs: answer.latencyMs,
        modelId: answer.modelId,
      };
    } catch (error) {
      if (error instanceof GatewayTimeoutException) return { failureCode: 'LLM_TIMEOUT' };
      if (error instanceof ServiceUnavailableException) return { failureCode: 'LLM_DISABLED' };
      return { failureCode: 'LLM_UNAVAILABLE' };
    }
  }

  private mapCitationsSafely(
    answer: GroundedAnswerResult,
    chunks: RetrievedChunk[],
  ): AssistantSourceRowLike[] | { failureCode: string } {
    try {
      return mapCitations(answer, chunks);
    } catch {
      return { failureCode: 'LLM_UNSUPPORTED_CITATION' };
    }
  }
}