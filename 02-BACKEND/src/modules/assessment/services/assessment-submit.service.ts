import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProfileLifecycleService } from '../../profile/profile-lifecycle.service';
import { AssessmentAnswerStore } from './assessment-answer-store.service';
import { ASSESSMENT_DEFINITION_VERSION } from '../constants/assessment-definition';
import { type SubmitResponse } from '../dto/assessment.dto';
import {
  AssessmentCorruptException,
  AssessmentNotFoundException,
  IncompleteAssessmentException,
  ResultNotFoundException,
} from '../constants/assessment.errors';
import { presentResult, type ResultInsight } from '../dto/result-presenter';
import { ScoringService } from './scoring.service';
import {
  collectGoalFreeText,
  collectPriorities,
  extractCurrentState,
  goalFreeTextInput,
  toResultResponse,
} from '../utils/assessment-result-mapping';

/**
 * Assessment submission (FR-015, FR-034, AC-X4, research D6, contracts/assessment.md).
 * Final, idempotent submission: conditional state transition
 * `IN_PROGRESS → SUBMITTED → SCORED`, exactly one `AssessmentResult`
 * (unique on `assessment_id`), deterministic scoring via `ScoringService` (no AI,
 * no overall score — FR-016/FR-018/FR-030).
 *
 * US5 scope (NORMAL path completion):
 *  - Submit assembles the non-diagnostic coaching insight via `presentResult`
 *    (FR-017/FR-018) and transitions onboarding `ASSESSMENT_IN_PROGRESS →
 *    COMPLETED` (data-model §7 line 151: result presented → COMPLETED). The
 *    response carries the insight inline + `next: /assessment/result`.
 *  - The insight is built only from deterministic domain scores + priorities and
 *    never sent to any AI provider (FR-030).
 */
@Injectable()
export class AssessmentSubmitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileLifecycle: ProfileLifecycleService,
    private readonly scoring: ScoringService,
    private readonly answers: AssessmentAnswerStore,
  ) {}

  async submit(userId: string): Promise<SubmitResponse> {
    await this.profileLifecycle.assertCanEnterAssessment(userId);

    const assessment = await this.prisma.assessment.findFirst({ where: { userId } });
    if (!assessment) throw new AssessmentNotFoundException();

    // Idempotent: an existing result means a prior submit already scored — return
    // its insight (onboarding is already COMPLETED).
    const existing = await this.prisma.assessmentResult.findFirst({
      where: { assessmentId: assessment.id },
    });
    if (existing) return this.insightResponse(existing, true);

    // US8 (FR-034, SC-007): fail-closed — NEVER score stale answers collected
    // against a retired definition into a "complete" result. If the active
    // assessment's definition version no longer matches the current definition
    // and no result exists yet (i.e. not SCORED), the saved progress is
    // inconsistent — refuse submission and steer the user to a safe restart
    // (GET /assessment returns `requires_safe_restart`). No partial result is
    // presented as complete. SCORED is already handled by the existing-result
    // early return above.
    if (
      assessment.definitionVersion !== ASSESSMENT_DEFINITION_VERSION &&
      assessment.state !== 'SCORED'
    ) {
      throw new AssessmentCorruptException();
    }

    // Required-question completeness (FR-014a). The normal path enforces the
    // 16 current-state + AG-01/AG-02/AG-03 set.
    const missing = await this.answers.missingRequired(assessment.id);
    if (missing.length) throw new IncompleteAssessmentException(missing);

    // Conditional transition IN_PROGRESS → SUBMITTED (research D6).
    const now = new Date();
    const upd = await this.prisma.assessment.updateMany({
      where: { id: assessment.id, state: { in: ['IN_PROGRESS'] } },
      data: { state: 'SUBMITTED', submittedAt: now },
    });
    if (upd.count === 0) {
      // Race: a concurrent submit won the transition. Return its result if present.
      const race = await this.prisma.assessmentResult.findFirst({
        where: { assessmentId: assessment.id },
      });
      if (race) return this.insightResponse(race, true);
      throw new IncompleteAssessmentException([]); // fail closed
    }

    // Deterministic scoring over the saved current-state answers (no AI, FR-030).
    const answers = await this.answers.loadAnswers(assessment.id);
    const scored = this.scoring.score(extractCurrentState(answers));

    const result = await this.prisma.assessmentResult.create({
      data: {
        assessmentId: assessment.id,
        userId,
        definitionVersion: assessment.definitionVersion,
        domainScores: scored.domain_scores as unknown as Prisma.InputJsonValue,
        strongestDomain: scored.strongest_domain,
        supportDomain: scored.support_domain,
        selectedPriorities: collectPriorities(answers) as unknown as Prisma.InputJsonValue,
        goalFreeText: goalFreeTextInput(collectGoalFreeText(answers)),
      },
    });

    await this.prisma.assessment.update({
      where: { id: assessment.id },
      data: { state: 'SCORED' },
    });
    // US5: result presented → COMPLETED (data-model §7 line 151, FR-018).
    await this.profileLifecycle.markAssessmentComplete(userId, now);

    return this.insightResponse(result, false);
  }

  /** Non-diagnostic coaching insight read (US5, FR-017/FR-018); 404 when no result
   * yet. After COMPLETED this endpoint's read remains available (the result is
   * shown once at the transition point); retake/restart remain disallowed
   * (FR-018a). */
  async getResult(userId: string): Promise<ResultInsight> {
    const result = await this.prisma.assessmentResult.findFirst({ where: { userId } });
    if (!result) throw new ResultNotFoundException();
    return presentResult(toResultResponse(result));
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** Build the submit response carrying the presenter insight. `duplicate`
   * marks a retry that returned the existing result (FR-015). */
  private insightResponse(
    row: { id: string; definitionVersion: string; domainScores: unknown; strongestDomain: string; supportDomain: string; selectedPriorities: unknown; goalFreeText: unknown },
    duplicate: boolean,
  ): SubmitResponse {
    return {
      result_id: row.id,
      assessment_state: 'SCORED',
      onboarding_state: 'COMPLETED',
      result: presentResult(toResultResponse(row)),
      next: '/assessment/result',
      ...(duplicate ? { duplicate: true } : {}),
    };
  }
}