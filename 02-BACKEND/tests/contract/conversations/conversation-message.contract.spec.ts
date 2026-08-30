import { describe, expect, it } from 'vitest';
import { SendMessageDto } from '../../../src/modules/conversations/dto/conversation.dto';
import { validateDto } from '../../helpers/dto-validate';

describe('conversation send-message contract', () => {
  it('validates content, trims it, and rejects empty messages', async () => {
    expect((await validateDto(SendMessageDto, { content: '  Hello  ' })).content).toBe('Hello');
    await expect(validateDto(SendMessageDto, { content: '   ' })).rejects.toThrow();
  });
});