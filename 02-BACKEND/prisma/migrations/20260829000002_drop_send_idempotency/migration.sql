-- Remove conversation-send idempotency (learning/MVP simplification).
-- The (userId, conversationId, idempotencyKey) unique index and its nullable
-- column are no longer written; dropping index first, then the column.
DROP INDEX IF EXISTS "ConversationMessage_userId_conversationId_idempotencyKey_key";

ALTER TABLE "ConversationMessage" DROP COLUMN IF EXISTS "idempotencyKey";