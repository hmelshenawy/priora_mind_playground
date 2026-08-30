import { AiService } from '../../src/modules/ai/ai.service';
import { ConversationMessageService } from '../../src/modules/conversations/services/conversation-message.service';
import { ConversationHistoryService } from '../../src/modules/conversations/services/conversation-history.service';
import type { makeConversationPrismaStub } from './fake-conversation-prisma';
import { FakeConversationAi } from './fake-conversation-ai';
import { FakeConversationRagClient } from './fake-conversation-rag-client';

/** Build the full conversation message stack with a real AiService orchestrator
 *  backed by the fake LLM provider / RAG client: exercising the AI module's
 *  routing, ragMessage generation, validation, and citation mapping for real. */
export function makeConversationStack(options: {
  prisma: ReturnType<typeof makeConversationPrismaStub>;
  provider?: FakeConversationAi;
  rag?: FakeConversationRagClient;
}) {
  const provider = options.provider ?? new FakeConversationAi();
  const rag = options.rag ?? new FakeConversationRagClient();
  const ai = new AiService(provider, rag as never);
  const service = new ConversationMessageService(
    options.prisma as never,
    { assertEligible: async () => undefined } as never,
    new ConversationHistoryService(options.prisma as never),
    ai,
  );
  return { service, ai, provider, rag };
}