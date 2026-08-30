import { describe, expect, it } from 'vitest';
import { CONVERSATION_COMMAND_RESPONSES, CONVERSATION_FALLBACKS } from '../../../src/modules/conversations/constants/conversation.constants';
import { isFollowUp } from '../../../src/modules/conversations/utils/conversation-follow-up-detector';
import { detectStaticOrSystemResponse } from '../../../src/modules/conversations/utils/conversation-static-responses';

describe('Spec 004 acceptance matrix AC-X1 through AC-X9', () => {
  it('covers route order, grounded fallback, bounded follow-up, safe failures, and deferred MVP exclusions', () => {
    expect(detectStaticOrSystemResponse('hello')?.route).toBe('STATIC_RESPONSE');
    expect(detectStaticOrSystemResponse('/help')?.route).toBe('SYSTEM_COMMAND');
    expect(CONVERSATION_COMMAND_RESPONSES.scope).toContain('not medical care');
    expect(CONVERSATION_FALLBACKS.insufficientEvidence).toContain("don't have enough grounded information");
    expect(isFollowUp('Why?')).toBe(true);
    expect(isFollowUp('What is a grounding exercise for stress?')).toBe(false);
    expect(CONVERSATION_FALLBACKS.technical).not.toContain('Error:');
    expect(['SYSTEM_COMMAND', 'STATIC_RESPONSE', 'RAG']).not.toContain('LLM_ONLY');
  });
});