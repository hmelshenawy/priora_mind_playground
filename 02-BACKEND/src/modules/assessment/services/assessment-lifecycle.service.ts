import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProfileLifecycleService } from '../../profile/profile-lifecycle.service';
import { ValidationHttpError } from '../../../common/validation/validation-http.error';
import {
  ASSESSMENT_DEFINITION_V1,
  ASSESSMENT_DEFINITION_VERSION,
  type DomainCode,
} from '../constants/assessment-definition';
import {
  kindForQuestionId,
} from '../dto/answer-value.dto';
import {
  type AssessmentView,
  type DefinitionResponse,
  type SaveAnswerResponse,
} from '../dto/assessment.dto';
import {
  QuestionNotFoundException,
  RestartNotAllowedException,
} from '../constants/assessment.errors';
import { buildDefinitionResponse } from '../dto/assessment-definition-view';
import { AssessmentAnswerStore } from './assessment-answer-store.service';

/**
 * Assessment lifecycle orchestration (FR-013/FR-014/FR-014a/FR-014b, contracts/
 * assessment.md, data-model §8/§9). Owns the active-Assessment flow: definition view,
 * resume/safe-restart, answer save, and onboarding-state transitions. The
 * OnboardingGuard (T033) gates every step on EMAIL_VERIFIED + consent (FR-006);
 * route guards are UX only (FR-028). All writes filter by `userId` server-side
 * (FR-027/FR-029).
 *
 * Answer persistence + required-set computation live in `AssessmentAnswerStore`, and
 * the pure definition view in `assessment-definition-view.ts` (Constitution VIII
 * split).
 */
@Injectable()
export class AssessmentLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileLifecycle: ProfileLifecycleService,
    private readonly answers: AssessmentAnswerStore,
  ) {}

  async getDefinition(): Promise<DefinitionResponse> {
    return buildDefinitionResponse();
  }

  async getAssessment(userId: string): Promise<AssessmentView> {
    await this.profileLifecycle.assertCanEnterAssessment(userId);
    const assessment = await this.answers.upsertActive(userId);

    // US8 (FR-034, SC-007): corrupt/inconsistent-progress detection. If the active
    // assessment's definition version no longer matches the current definition:
    //  - IN_PROGRESS (saved answers exist): the saved progress is inconsistent with
    //    the current definition — offer a SAFE RESTART. Stale answers are NOT surfaced
    //    as a resumable view and no next question is offered (no partial result is
    //    presented as resumable or complete). The user restarts, which re-anchors.
    //  - NOT_STARTED (no answers yet): silently re-anchor to the current definition —
    //    no data to corrupt, so the user simply starts on the current version.
    //  - SUBMITTED/SCORED: a completed assessment on a prior version is NOT "partial
    //    progress" — leave it as-is (results stand). This guard is resume-only.
    if (assessment.definitionVersion !== ASSESSMENT_DEFINITION_VERSION) {
      if (assessment.state === 'IN_PROGRESS') {
        return {
          assessment_id: assessment.id,
          definition_version: assessment.definitionVersion,
          assessment_state: assessment.state,
          next_question_id: null,
          answered: [],
          introduction: {
            en: ASSESSMENT_DEFINITION_V1.current_state_instruction_en,
            ar: ASSESSMENT_DEFINITION_V1.current_state_instruction_ar,
          },
          requires_safe_restart: true,
        };
      }
      if (assessment.state === 'NOT_STARTED') {
        await this.prisma.assessment.update({
          where: { id: assessment.id },
          data: { definitionVersion: ASSESSMENT_DEFINITION_VERSION },
        });
        assessment.definitionVersion = ASSESSMENT_DEFINITION_VERSION;
      }
    }

    const answers = await this.answers.loadAnswers(assessment.id);
    const view: AssessmentView = {
      assessment_id: assessment.id,
      definition_version: assessment.definitionVersion,
      assessment_state: assessment.state,
      next_question_id: await this.answers.nextQuestion(answers),
      answered: answers.map((a) => ({ question_id: a.questionId, value: a.value })),
      introduction: {
        en: ASSESSMENT_DEFINITION_V1.current_state_instruction_en,
        ar: ASSESSMENT_DEFINITION_V1.current_state_instruction_ar,
      },
    };
    return view;
  }

  async saveAnswer(
    userId: string,
    questionId: string,
    answer: unknown,
  ): Promise<SaveAnswerResponse> {
    await this.profileLifecycle.assertCanEnterAssessment(userId);

    const kind = kindForQuestionId(questionId);
    if (!kind) throw new QuestionNotFoundException();
    // `answer` has already been validated + transformed against the matching
    // per-kind DTO by SaveAnswerBodyPipe (400 VALIDATION, field paths only).

    const assessment = await this.answers.upsertActive(userId);
    await this.crossValidate(userId, assessment.id, questionId, answer);

    const now = new Date();
    await this.answers.upsertAnswer(assessment.id, questionId, kind, answer, now);

    if (assessment.state === 'NOT_STARTED') {
      await this.prisma.assessment.update({
        where: { id: assessment.id },
        data: { state: 'IN_PROGRESS', startedAt: now, lastActivityAt: now },
      });
      await this.profileLifecycle.markAssessmentInProgress(userId, now);
    } else {
      await this.prisma.assessment.update({
        where: { id: assessment.id },
        data: { lastActivityAt: now },
      });
      await this.profileLifecycle.touchOnboardingActivity(userId, now);
    }

    const answers = await this.answers.loadAnswers(assessment.id);
    return {
      saved: true,
      assessment_state: assessment.state === 'NOT_STARTED' ? 'IN_PROGRESS' : assessment.state,
      next_question_id: await this.answers.nextQuestion(answers),
    };
  }

  async restart(userId: string): Promise<void> {
    await this.profileLifecycle.assertCanEnterAssessment(userId);
    const assessment = await this.prisma.assessment.findFirst({ where: { userId } });
    if (!assessment || assessment.state === 'NOT_STARTED') return; // nothing to restart
    if (assessment.state === 'SCORED') throw new RestartNotAllowedException();
    const now = new Date();
    await this.prisma.assessmentAnswer.deleteMany({ where: { assessmentId: assessment.id } });
    // US8 (FR-034, SC-007): restart re-anchors the assessment to the CURRENT
    // definition version — clearing stale answers collected against a retired
    // definition and resetting the pointer so resume + submit run on the current
    // definition. This is the safe-restart exit from the corrupt-progress state.
    await this.prisma.assessment.update({
      where: { id: assessment.id },
      data: {
        state: 'IN_PROGRESS',
        definitionVersion: ASSESSMENT_DEFINITION_VERSION,
        startedAt: now,
        submittedAt: null,
        lastActivityAt: now,
      },
    });
    await this.profileLifecycle.markAssessmentInProgress(userId, now);
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** Cross-question consistency (Assessment §6): AG-02 ranks + AG-03 goals must
   * cover the AG-01 selection exactly. Throws ValidationHttpError (→ 400 VALIDATION)
   * on mismatch so no answer is persisted. The thrown fields carry only the rule
   * that was violated — never the submitted answer value (FR-037). */
  private async crossValidate(
    _userId: string,
    assessmentId: string,
    questionId: string,
    parsed: unknown,
  ): Promise<void> {
    if (questionId !== 'AG-02' && questionId !== 'AG-03') return;
    const ag01 = await this.prisma.assessmentAnswer.findFirst({
      where: { assessmentId, questionId: 'AG-01' },
    });
    if (!ag01) throw validationError([questionId], 'AG-01 must be answered first');
    const selected = (ag01.value as { domains: DomainCode[] }).domains;
    if (questionId === 'AG-02') {
      const ranking = (parsed as { ranking: Record<string, number> }).ranking;
      const keys = Object.keys(ranking);
      if (keys.length !== selected.length || !selected.every((d) => d in ranking)) {
        throw validationError(['ranking'], 'ranking must cover the AG-01 selection');
      }
      const ranks = Object.values(ranking);
      if (new Set(ranks).size !== ranks.length) {
        throw validationError(['ranking'], 'ranks must be unique');
      }
    } else {
      const goals = (parsed as { goals: Record<string, unknown> }).goals;
      const keys = Object.keys(goals);
      if (keys.length !== selected.length || !selected.every((d) => d in goals)) {
        throw validationError(['goals'], 'goals must cover the AG-01 selection');
      }
    }
  }

}

/** Cross-question mismatches map to the same 400 VALIDATION body the global
 * ValidationPipe produces — a field path naming only the violated rule, never
 * the submitted value (FR-037). */
function validationError(path: (string | number)[], message: string): never {
  throw new ValidationHttpError([{ path: path.join('.'), message }]);
}
