-- Remove the safety feature (tables, enums, and the loose reference column).
-- Migration hand-authored: `prisma migrate dev` cannot be used in this environment
-- (no local dev DB) and would emit unsupported `ALTER TYPE ... DROP VALUE` for the
-- shared enums. Safety-only enums are dropped outright; orphan values in shared
-- enums ('safety' in QuestionKind, 'SAFETY_HOLD' in OnboardingStateValue,
-- 'SAFETY' in ConversationMessageRoute, 'SUSPENDED' in AssessmentStateValue) are
-- inert in Postgres (enum values cannot be dropped) and harmless: no column
-- default or constraint references them.

ALTER TABLE "AssessmentResult" DROP COLUMN IF EXISTS "safetyEvaluationId";

DROP TABLE IF EXISTS "SafetyEvaluation";
DROP TABLE IF EXISTS "SafetyDefinition";
DROP TABLE IF EXISTS "SafetyCopy";
DROP TABLE IF EXISTS "EmergencyResource";

DROP TYPE IF EXISTS "SafetyLevel";
DROP TYPE IF EXISTS "TriggerContext";