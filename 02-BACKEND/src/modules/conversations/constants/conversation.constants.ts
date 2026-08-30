/** Conversation-side limits. RAG retrieval limits (search size, score
 *  threshold, context budget) live in the AI module — they govern retrieval,
 *  which the AI layer owns. */
export const CONVERSATION_LIMITS = {
  titleMaxLength: 120,
  messageMaxLength: 4000,
  defaultPageSize: 25,
  maxPageSize: 100,
  recentHistoryMessages: 10,
  recentHistoryMaxChars: 6000,
} as const;

export const CONVERSATION_FALLBACKS = {
  technical: "I'm having trouble processing that right now. Please try again in a moment.",
} as const;
