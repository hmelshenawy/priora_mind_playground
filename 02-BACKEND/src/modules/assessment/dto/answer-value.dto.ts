import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DomainCode, QuestionKind } from '../constants/assessment-definition';

/**
 * Assessment answer-value DTOs (contracts/assessment.md, FR-013..FR-016, FR-037).
 * The answer body shape is determined by the `question_id` route param, so the
 * `SaveAnswerBodyPipe` selects the matching DTO class here and validates the
 * body with class-validator. Field paths only — never the submitted value.
 */

export const DOMAIN_CODES = [
  'stress',
  'mood',
  'energy',
  'sleep',
  'focus',
  'confidence',
  'relationships',
  'balance',
] as const;

/** current_state (AS-*): { value: 0|1|2|3|4 } */
export class CurrentStateAnswerDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  value!: number;
}

/** Each record value must be an integer ≥ 1 (ranks) / required non-empty goal text. */
function RequireEachValue(validateFn: (value: unknown) => string | null, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'requireEachValue',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          for (const item of Object.values(value)) {
            const message = validateFn(item);
            if (message) return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const firstInvalid = Object.values(args.value as Record<string, unknown>).find(
            (item) => validateFn(item) !== null,
          );
          return validateFn(firstInvalid) ?? `${args.property} has invalid values`;
        },
      },
    });
  };
}

/** goal_select (AG-01): { domains: DomainCode[1..3] } */
export class GoalSelectAnswerDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(DOMAIN_CODES as unknown as string[], { each: true })
  domains!: DomainCode[];
}

/** goal_rank (AG-02): { ranking: { [domain]: rank } } (unique ranks validated in service) */
export class GoalRankAnswerDto {
  @IsObject()
  @RequireEachValue((value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1 ? null : 'ranking must contain integer ranks ≥ 1',
  )
  ranking!: Record<string, number>;
}

export type Ag03GoalEntry = { text: string; suggested?: string };

/** goal_free_text (AG-03): per-selected-domain desired change; text required. */
export class GoalFreeTextAg03Dto {
  @IsObject()
  @RequireEachValue((value) => {
    const entry = value as { text?: unknown } | null;
    if (typeof entry !== 'object' || entry === null) return 'goals must map domains to goal objects';
    if (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 500) {
      return 'each goal must have text of 1..500 characters';
    }
    return null;
  })
  goals!: Record<string, Ag03GoalEntry>;
}

/** goal_free_text (AG-04): short free-text. */
export class GoalFreeTextAg04Dto {
  @IsString()
  @MaxLength(500)
  text!: string;
}

/** goal_free_text (AG-05): optional; user may skip (no answer saved). */
export class GoalFreeTextAg05Dto {
  @IsOptional()
  @IsString()
  suggested?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;
}

export type { QuestionKind };

/** Answer-value DTO class for a question id (null = unknown → 404). */
export function answerValueDtoForQuestionId(
  questionId: string,
): (new () => object) | null {
  if (questionId.startsWith('AS-')) return CurrentStateAnswerDto;
  switch (questionId) {
    case 'AG-01':
      return GoalSelectAnswerDto;
    case 'AG-02':
      return GoalRankAnswerDto;
    case 'AG-03':
      return GoalFreeTextAg03Dto;
    case 'AG-04':
      return GoalFreeTextAg04Dto;
    case 'AG-05':
      return GoalFreeTextAg05Dto;
    default:
      return null;
  }
}

/** Question kind for a question id (null = unknown). */
export function kindForQuestionId(questionId: string): QuestionKind | null {
  // Current-state ids are AS-*; goal questions AG-01..AG-05.
  if (questionId.startsWith('AS-')) return 'current_state';
  switch (questionId) {
    case 'AG-01':
      return 'goal_select';
    case 'AG-02':
      return 'goal_rank';
    case 'AG-03':
    case 'AG-04':
    case 'AG-05':
      return 'goal_free_text';
    default:
      return null;
  }
}
