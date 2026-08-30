import { Inject, Injectable, Scope, type PipeTransform, type ArgumentMetadata } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import type { Request } from 'express';
import { validate } from 'class-validator';
import { ValidationHttpError } from '../../../common/validation/validation-http.error';
import { answerValueDtoForQuestionId } from './answer-value.dto';

/**
 * Polymorphic answer-body validation: the DTO class is selected from the
 * `question_id` route param (the shape depends on the question, not the URL),
 * so this request-scoped pipe reads the route param from the current request
 * while validating only the value supplied by `@Body`.
 * Returns the validated + transformed answer value; unknown question ids pass
 * through — the lifecycle service throws QuestionNotFoundException (404), which
 * stays the single source of the unknown-id contract. Validation failures throw
 * ValidationHttpError (400 VALIDATION, field paths only — never the value).
 */
@Injectable({ scope: Scope.REQUEST })
export class SaveAnswerBodyPipe implements PipeTransform<unknown, Promise<unknown>> {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  async transform(value: unknown, _metadata: ArgumentMetadata): Promise<unknown> {
    const body = typeof value === 'object' && value !== null ? value : {};
    const questionIdParam = this.request.params.question_id;
    const questionId = Array.isArray(questionIdParam) ? questionIdParam[0] : questionIdParam;
    if (typeof questionId !== 'string') return body;

    const Dto = answerValueDtoForQuestionId(questionId);
    if (!Dto) return body; // unknown id → the service throws QuestionNotFoundException

    const instance = plainToInstance(Dto, body);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    });
    if (errors.length > 0) throw ValidationHttpError.fromErrors(errors);
    return instance;
  }
}
