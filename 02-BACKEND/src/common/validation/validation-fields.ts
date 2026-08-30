import type { ValidationError } from '@nestjs/common';

/**
 * Flatten a ValidationPipe error tree into `{ path, message }` pairs with
 * dot-joined child paths. Never echoes the submitted values (FR-037, FR-030).
 */
export function flattenValidationFields(errors: ValidationError[]): Array<{ path: string; message: string }> {
  const fields: Array<{ path: string; message: string }> = [];

  const walk = (error: ValidationError, parentPath: string): void => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    if (error.constraints) {
      for (const message of Object.values(error.constraints)) {
        fields.push({ path, message });
      }
    }
    for (const child of error.children ?? []) {
      walk(child, path);
    }
  };

  for (const error of errors) {
    walk(error, '');
  }
  return fields;
}