import { describe, expect, it } from 'vitest';
import {
  CreateConversationDto,
  GetConversationQueryDto,
  ListConversationsQueryDto,
  PatchConversationDto,
  SendMessageDto,
} from '../../../src/modules/conversations/dto/conversation.dto';
import { validateDto } from '../../helpers/dto-validate';

describe('conversation API contract foundation', () => {
  it('rejects client-supplied user ids in create payloads', async () => {
    await expect(
      validateDto(CreateConversationDto, { title: 'Stress tools', userId: 'user-1' }),
    ).rejects.toThrow();
  });

  it('validates lifecycle and send-message MVP request shapes', async () => {
    expect(
      await validateDto(ListConversationsQueryDto, { includeArchived: 'true', limit: '10' }),
    ).toMatchObject({ includeArchived: true, limit: 10 });
    expect(await validateDto(GetConversationQueryDto, { messagesLimit: '10' })).toMatchObject({
      messagesLimit: 10,
    });
    expect(await validateDto(PatchConversationDto, { archived: true })).toMatchObject({
      archived: true,
    });
    expect((await validateDto(SendMessageDto, { content: 'What is grounding?' })).content).toBe(
      'What is grounding?',
    );
  });
});