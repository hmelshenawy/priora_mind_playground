import { plainToInstance } from 'class-transformer';
import { createGlobalValidationPipe } from '../../src/common/validation/validation.pipe';

/**
 * Runs a body through the same pipe main.ts installs (whitelist, transforms,
 * forbidNonWhitelisted). Returns the transformed instance; throws
 * ValidationHttpError (400 VALIDATION, field paths only) on failure.
 */
export async function validateDto<T>(dto: new () => T, value: unknown): Promise<T> {
  const pipe = createGlobalValidationPipe();
  const instance = plainToInstance(dto, value as object);
  return (await pipe.transform(instance, {
    type: 'body',
    metatype: dto as never,
    data: '',
  })) as T;
}