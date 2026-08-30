/**
 * Shared class-transformer transforms used by DTO classes (replaces the
 * equivalent Zod coercions: .trim(), boolean-string parsing, number coercion).
 */

/** Trim strings on input. */
export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Parse `'true'/'false'` strings (query params) into booleans, pass others through. */
export const toBool = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};