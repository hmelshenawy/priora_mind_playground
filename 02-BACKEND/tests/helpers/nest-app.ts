import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { createGlobalValidationPipe } from '../../src/common/validation/validation.pipe';

/**
 * Boots a Test.createTestingModule app mirroring main.ts: global prefix, cookie
 * parsing, the global ValidationPipe and the AllExceptionsFilter.
 *
 * CRITICAL: pipes/filters registered in main.ts do NOT apply to test apps —
 * without this helper every validation path silently vanishes from the
 * contract/e2e suites.
 */
export async function initTestApp(module: TestingModule): Promise<INestApplication> {
  const app = module.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}