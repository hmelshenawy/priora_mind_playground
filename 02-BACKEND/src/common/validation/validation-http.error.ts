import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { flattenValidationFields } from './validation-fields';

/**
 * 400 carrying the stable `VALIDATION` error shape with only field paths and
 * messages — never the submitted values.
 */
export class ValidationHttpError extends BadRequestException {
  constructor(fields: Array<{ path: string; message: string }>) {
    super({
      error: {
        code: 'VALIDATION',
        fields,
      },
    });
    this.message = `VALIDATION: ${fields.map((field) => field.path).join(', ')}`;
  }

  static fromErrors(errors: ValidationError[]): ValidationHttpError {
    return new ValidationHttpError(flattenValidationFields(errors));
  }
}
