import { describe, expect, it } from 'vitest';
import { isFollowUp } from '../../../../src/modules/conversations/utils/conversation-follow-up-detector';

describe('conversation follow-up detector', () => {
  it('detects short dependent questions and previous-discussion references', () => {
    expect(isFollowUp('Why?')).toBe(true);
    expect(isFollowUp('Can you explain that?')).toBe(true);
    expect(isFollowUp('What about the previous idea?')).toBe(true);
  });

  it('passes through clear standalone queries', () => {
    expect(isFollowUp('What is a grounding exercise for acute stress?')).toBe(false);
  });
});
