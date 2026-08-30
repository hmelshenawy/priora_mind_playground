// Removed (Phase 4): request validation now runs through the single global
// ValidationPipe (class-validator DTOs) — see ./validation.pipe.ts.
// The shell is currently unavailable, so this former ZodValidationPipe /
// BadRequestValidation file is emptied to keep `nest build` free of Zod; it is
// deleted in the same change.