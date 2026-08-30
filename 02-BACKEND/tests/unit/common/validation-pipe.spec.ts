import { describe, it, expect } from 'vitest';
import { ValidationHttpError } from '../../../src/common/validation/validation-http.error';
import { flattenValidationFields } from '../../../src/common/validation/validation-fields';
import { createGlobalValidationPipe } from '../../../src/common/validation/validation.pipe';
import { toBool } from '../../../src/common/validation/transforms';
import { RegisterDto } from '../../../src/modules/auth/dto/auth.dto';
import { RecordConsentDto } from '../../../src/modules/auth/dto/consent.dto';
import { SendMessageDto } from '../../../src/modules/conversations/dto/conversation.dto';
import { GoalSelectAnswerDto } from '../../../src/modules/assessment/dto/answer-value.dto';
import { plainToInstance } from 'class-transformer';

/**
 * Global ValidationPipe contract (FR-037): the 400 VALIDATION body carries only
 * field paths + rule messages — never the submitted values — and replaces the
 * former Zod layer end to end.
 */
describe('global ValidationPipe', () => {
  const pipe = createGlobalValidationPipe();

  async function validate<T>(dto: new () => T, value: unknown) {
    const instance = plainToInstance(dto, value as object);
    try {
      await pipe.transform(instance, { type: 'body', metatype: dto as never, data: '' });
      return null;
    } catch (err) {
      return err as ValidationHttpError;
    }
  }

  function fieldsOf(err: ValidationHttpError | null) {
    return JSON.parse(JSON.stringify((err as ValidationHttpError).getResponse())) as {
      error: { code: string; fields: { path: string; message: string }[] };
    };
  }

  it('rejects an unknown (non-whitelisted) key with 400 VALIDATION', async () => {
    const err = await validate(SendMessageDto, { content: 'hello', admin: true });
    const body = fieldsOf(err);
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.fields.some((f) => f.path === 'admin')).toBe(true);
  });

  it('rejects a wrong type with a field path and no value echo', async () => {
    const err = await validate(SendMessageDto, { content: 42 });
    const body = fieldsOf(err);
    expect(body.error.code).toBe('VALIDATION');
    expect(JSON.stringify(body)).toContain('content');
    expect(JSON.stringify(body)).not.toContain('42');
  });

  it('reports nested object errors with dot-joined child paths', async () => {
    const err = await validate(RecordConsentDto, {
      service_boundary_version: 'boundary-1.0',
      terms_version: 'terms-1.0',
      privacy_notice_version: 'privacy-1.0',
      consent_language_code: 'en',
      acknowledgments: { service_boundary: true, terms: 'not-a-boolean', privacy_notice: true },
    });
    const body = fieldsOf(err);
    expect(body.error.fields.some((f) => f.path === 'acknowledgments.terms')).toBe(true);
  });

  it('accepts a fully valid payload (all constraints satisfied)', async () => {
    const ok = await validate(RegisterDto, { email: 'x@test.dev', password: 'a'.repeat(8) });
    expect(ok).toBeNull();
  });

  it('never echoes the submitted value in a failed field', async () => {
    const secret = 'super-secret-password-value'.repeat(6);
    const err = await validate(RegisterDto, { email: 'x@test.dev', password: secret });
    const body = fieldsOf(err);
    expect(body.error.code).toBe('VALIDATION');
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(
      body.error.fields.every((f) => typeof f.path === 'string' && typeof f.message === 'string'),
    ).toBe(true);
  });

  it('flattenValidationFields resolves child paths under the parent path', () => {
    const fields = flattenValidationFields([
      {
        property: 'acknowledgments',
        children: [
          { property: 'terms', constraints: { isBoolean: 'terms must be a boolean value' } },
        ],
      },
    ]);
    expect(fields).toEqual([{ path: 'acknowledgments.terms', message: 'terms must be a boolean value' }]);
  });

  it('toBool maps the boolean query strings and leaves other values alone', () => {
    expect(toBool({ value: 'true' })).toBe(true);
    expect(toBool({ value: 'false' })).toBe(false);
    expect(toBool({ value: true })).toBe(true);
    expect(toBool({ value: undefined })).toBeUndefined();
  });

  it('goal_select answers accept 1..3 domains and reject an unknown domain', async () => {
    const ok = await validate(GoalSelectAnswerDto, { domains: ['stress', 'mood'] });
    expect(ok).toBeNull();
    const bad = await validate(GoalSelectAnswerDto, { domains: ['bananas'] });
    expect(fieldsOf(bad).error.fields.some((f) => f.path === 'domains')).toBe(true);
  });
});
