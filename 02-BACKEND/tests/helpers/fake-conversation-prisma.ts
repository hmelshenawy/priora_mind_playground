import { vi } from 'vitest';

/**
 * Prisma-shaped test double for the conversation services (message, context,
 * access, lifecycle). `create` synthesizes user/assistant rows from `data`;
 * `conversationMessage.findMany` returns the supplied history rows (newest
 * first, as ConversationHistoryService expects); `conversation.findFirst`
 * returns the supplied conversation row.
 */
export function makeConversationPrismaStub(options: {
  conversation?: Record<string, unknown> | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
} = {}) {
  let assistantIndex = 0;
  return {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(options.conversation ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: (options.conversation?.id as string) ?? 'conversation-1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    onboardingState: {
      findFirst: vi.fn().mockResolvedValue({ state: 'COMPLETED' }),
    },
    conversationMessage: {
      findMany: vi.fn().mockResolvedValue(options.history ?? []),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = data.role === 'user' ? 'user-message-1' : `assistant-message-${++assistantIndex}`;
        // Mimic `include: { sources: true }`: nested sources.create become rows.
        const { sources, ...rest } = data as { sources?: { create: unknown[] } };
        return Promise.resolve({ id, ...rest, sources: sources?.create ?? [] });
      }),
    },
  };
}