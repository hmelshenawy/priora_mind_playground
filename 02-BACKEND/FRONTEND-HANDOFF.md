# Backend simplification — frontend hand-off

The backend refactor (Phases 1–4) removed the safety routing feature and the
send-idempotency layer, and switched all request validation from per-route Zod
schemas to a single global `ValidationPipe` (class-validator DTOs). The shared
type package `packages/shared` no longer exports the safety types.

**Backend gates are green. The frontend build is NOT — it is expected to be red
until the files below are updated.** This is out of scope for the backend
refactor; it is a follow-up work item.

## 1. Removed from `@priora/shared-types`

- `SafetyLevel` type (and all `'NORMAL' | 'DISTRESS' | 'HIGH_RISK' | 'CRISIS'` usage)
- `'SAFETY_HOLD'` from the onboarding-state union
- `'SAFETY'` from the conversation-message route union
- `safety_route` / `safety_questions` result fields, `distress_note`
- The safety hold onboarding step no longer exists — onboarding now ends
  linearly at `COMPLETED` after the assessment.

## 2. Breaking API changes

| Change | Impact |
|---|---|
| Send idempotency removed | Drop the `X-Idempotency-Key` request header on `POST /conversations/:id/messages`; retries now simply re-send. |
| Validation errors | Shape is unchanged (`error.code === 'VALIDATION'`, `fields: [{path, message}]`), but messages come from class-validator defaults plus rule names like `INVALID_TIMEZONE`. Match on `path`, not on message text. |
| Conversation list query | `includeArchived` now only accepts the strings `true`/`false` (any other string is a 400 `VALIDATION`). |
| Unknown route values | A `SAFETY` route value can no longer appear in any payload. |
| Onboarding completion | `GET /onboarding/completion` returns `completed: true` only at `COMPLETED`; there is no safety-hold route anymore. |

## 3. Files that reference removed types (build breaks)

Source:

- `src/features/safety/safety.api.ts` — delete (whole safety feature removed)
- `src/features/safety/safety-hooks.ts` — delete
- `src/features/safety/safety-route-view.tsx` — delete
- `src/app/[locale]/(protected)/safety/hold/page.tsx` — delete (route gone)
- `src/features/chat/chat-state.ts` — drop `SAFETY` route handling
- `src/features/coaching/coaching-dashboard-state.ts` — drop safety gating
- `src/features/onboarding/profile.api.ts` — drop safety-hold step mapping
- `src/features/assessment/assessment.api.ts` / `assessment-wizard.tsx` — drop
  SQ questions / safety result fields
- `src/components/guards/require-onboarding.tsx` — remove `SAFETY_HOLD` step
- `src/app/[locale]/(protected)/assessment/result/page.tsx` — remove
  `distress_note` / safety banner
- `src/app/[locale]/(protected)/dashboard/page.tsx` — remove safety banner
- `src/app/[locale]/(public)/login/page.tsx` — remove safety-hold redirect

Tests:

- `tests/e2e/i18n-fallback.spec.ts`, `tests/e2e/login.spec.ts`,
  `tests/e2e/chatbot-state-mapping.spec.ts`,
  `tests/e2e/coaching-dashboard-state.spec.ts`,
  `tests/e2e/home-dashboard.spec.ts` — strip safety cases
- `src/i18n/fallback.ts` — keep only if the locale strings are still referenced;
  otherwise drop the safety keys

## 4. Immutable legal copy (do not edit casually)

`prisma/seed/notice-versions.ts` — the `boundary-1.0` consent text still mentions
safety checks. That is immutable, consented legal copy: any wording change
requires a new notice version + a re-consent flow (Consent policy), not an edit.