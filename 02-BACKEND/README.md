# @priora/backend

NestJS modular monolith backend for Priora Mind — user onboarding, assessment, conversations, and coaching.

## Stack

NestJS 11 · Prisma (PostgreSQL) · class-validator/class-transformer DTOs (Zod for env config only) · `@nestjs/jwt` + Passport · Argon2id · `@nestjs/schedule` · OpenTelemetry · Auth-owned `EmailPort`.

## Architecture

Conventional flow per feature: **Controller → class-validator DTO → Service → Prisma / external service → Response**.

- One global `ValidationPipe` (whitelist + transform) produces the shared
  `{ error: { code: 'VALIDATION', fields: [{ path, message }] } }` body — field
  paths only, never the submitted values (FR-037).
- Services inject `PrismaService` and concrete module services directly; no port
  tokens, repositories, or `*.public.ts` barrels.
- Validation is only env config (Zod) + request DTOs (class-validator).

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Watch-mode dev server (prefix `/api/v1`, port `PORT` or 3000) |
| `npm run build` | Compile via `nest build` |
| `npm test` | Vitest unit + contract tests |
| `npm run test:e2e` | Vitest e2e (NestJS app + supertest) + lint |
| `npm run prisma:migrate` | Create/apply migrations |
| `npm run prisma:seed` | Seed reference content (NoticeVersionSet, definitions) |

## Layout

```
src/
  modules/   auth/ · profile/ · assessment/ · conversations/ · coaching/ · rag/ · retention/
  common/    validation/ · filters/ · config/ · observability/
  main.ts    app.module.ts
prisma/      schema.prisma · migrations/
tests/       unit/ · contract/ · e2e/
```

Test apps must attach the global pipe + filter via `tests/helpers/nest-app.ts`
(pipes registered in `main.ts` do not apply to `Test.createTestingModule` apps).