import { ValidationPipe } from '@nestjs/common';
import { ValidationHttpError } from './validation-http.error';

/**
 * The single global body/query/param validation pipe (whitelist + transform).
 * Global pipes configured in main.ts do not apply to Test.createTestingModule
 * apps — use `tests/helpers/nest-app.ts` to attach it there as well.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true, // strip unknown keys (replaces Zod .strict())
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false }, // never echo submitted values
    exceptionFactory: (errors) => ValidationHttpError.fromErrors(errors),
  });
}