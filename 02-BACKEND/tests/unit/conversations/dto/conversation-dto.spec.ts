import { describe, expect, it } from 'vitest';
import {
  CreateConversationDto,
  ListConversationsQueryDto,
  PatchConversationDto,
  SendMessageDto,
} from '../../../../src/modules/conversations/dto/conversation.dto';
import { validateDto } from '../../../helpers/dto-validate';

describe('conversation DTO validation foundation', () => {
  it('trims title and content and rejects empty values', async () => {
    expect((await validateDto(CreateConversationDto, { title: '  Stress tools  ' })).title).toBe(
      'Stress tools',
    );
    await expect(validateDto(CreateConversationDto, { title: '   ' })).rejects.toThrow();
    expect((await validateDto(SendMessageDto, { content: '  Hello  ' })).content).toBe('Hello');
    await expect(validateDto(SendMessageDto, { content: '   ' })).rejects.toThrow();
  });

  it('rejects unknown fields and invalid lifecycle actions', async () => {
    await expect(
      validateDto(CreateConversationDto, { title: 'Stress', userId: 'user-1' }),
    ).rejects.toThrow();
    await expect(
      validateDto(PatchConversationDto, { archived: true, title: 'Deferred' }),
    ).rejects.toThrow();
  });

  it('coerces bounded pagination values (boolean strings included)', async () => {
    expect(
      await validateDto(ListConversationsQueryDto, { limit: '25', includeArchived: 'false' }),
    ).toMatchObject({
      limit: 25,
      includeArchived: false,
    });
    await expect(validateDto(ListConversationsQueryDto, { limit: '1000' })).rejects.toThrow();
  });
});