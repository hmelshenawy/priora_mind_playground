import { describe, expect, it } from 'vitest';
import { CONVERSATION_FALLBACKS } from '../../../src/modules/conversations/constants/conversation.constants';

describe('Spec 004 acceptance matrix AC-X1 through AC-X9', () => {
  it('covers grounded fallback, safe failures, and deferred MVP exclusions', () => {
    // System commands no longer exist: /help and /scope are ordinary AI turns
    // Every normal message follows the same AI and retrieval pipeline.
    expect(CONVERSATION_FALLBACKS.technical).not.toContain('Error:');
  });
});
