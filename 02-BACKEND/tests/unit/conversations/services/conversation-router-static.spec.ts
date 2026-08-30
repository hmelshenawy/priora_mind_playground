import { describe, expect, it } from 'vitest';
import { detectStaticOrSystemResponse } from '../../../../src/modules/conversations/utils/conversation-static-responses';

describe('conversation static/system routing', () => {

  it('detects greetings and thanks as static responses', () => {
    expect(detectStaticOrSystemResponse('hello')).toMatchObject({
      route: 'STATIC_RESPONSE',
    });
    expect(detectStaticOrSystemResponse('thanks')).toMatchObject({
      route: 'STATIC_RESPONSE',
    });
  });

  it('detects help and scope as system commands', () => {
    expect(detectStaticOrSystemResponse('/help')).toMatchObject({ route: 'SYSTEM_COMMAND' });
    expect(detectStaticOrSystemResponse('/scope')).toMatchObject({
      route: 'SYSTEM_COMMAND',
    });
  });

  it('does not classify substantive messages as static or system commands', () => {
    expect(detectStaticOrSystemResponse('What is a grounding exercise?')).toBeNull();
  });
});
