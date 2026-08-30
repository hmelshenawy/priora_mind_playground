import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ASSESSMENT_DEFINITION_VERSION,
  COACHING_QUESTION_IDS,
  REQUIRED_COACHING_IDS,
} from '../constants/assessment-definition';

/**
 * Assessment answer store. Owns persistence + reads of `AssessmentAnswer` rows, the
 * active `Assessment` upsert, and the required/unanswered-set computation used to
 * drive the next-question pointer and submit completeness (FR-014a, data-model §8/§9).
 * All reads are scoped by `assessmentId` (itself owner-scoped by the caller). No
 * logging of answer content (FR-030). Holds no scoring logic.
 */
@Injectable()
export class AssessmentAnswerStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Required-question completeness for submit (FR-014a). Returns missing ids in the
   * full required order: 16 current-state + AG-01/02/03. */
  async missingRequired(assessmentId: string): Promise<string[]> {
    const answers = await this.loadAnswers(assessmentId);
    const have = new Set(answers.map((a) => a.questionId));
    return REQUIRED_COACHING_IDS.filter((id) => !have.has(id));
  }

  /** Load all saved answers for an assessment (ordered by definition question order). */
  async loadAnswers(assessmentId: string): Promise<{ questionId: string; value: unknown; questionKind: string }[]> {
    const rows = await this.prisma.assessmentAnswer.findMany({ where: { assessmentId } });
    const order = new Map(COACHING_QUESTION_IDS.map((id, i) => [id, i]));
    return rows
      .map((r) => ({ questionId: r.questionId, value: r.value, questionKind: r.questionKind }))
      .sort((a, b) => (order.get(a.questionId) ?? 999) - (order.get(b.questionId) ?? 999));
  }

  /** First required unanswered question id (coaching), or null when all required are
   * answered. */
  async nextQuestion(answers: { questionId: string }[]): Promise<string | null> {
    const have = new Set(answers.map((a) => a.questionId));
    return REQUIRED_COACHING_IDS.find((id) => !have.has(id)) ?? null;
  }

  /** Upsert the active assessment for a user (one active initial assessment, data-model
   * §8). Creates with the current definition version + NOT_STARTED when absent. */
  async upsertActive(userId: string) {
    const existing = await this.prisma.assessment.findFirst({ where: { userId } });
    if (existing) return existing;
    return this.prisma.assessment.create({
      data: { userId, definitionVersion: ASSESSMENT_DEFINITION_VERSION, state: 'NOT_STARTED' },
    });
  }

  /** Upsert a single answer row (create or update by assessmentId+questionId). */
  async upsertAnswer(
    assessmentId: string,
    questionId: string,
    kind: string,
    value: unknown,
    now: Date,
  ): Promise<void> {
    const existing = await this.prisma.assessmentAnswer.findFirst({
      where: { assessmentId, questionId },
    });
    if (existing) {
      await this.prisma.assessmentAnswer.update({
        where: { id: existing.id },
        data: { value: value as Prisma.InputJsonValue, updatedAt: now },
      });
    } else {
      await this.prisma.assessmentAnswer.create({
        data: {
          assessmentId,
          questionId,
          questionKind: kind as never,
          value: value as Prisma.InputJsonValue,
        },
      });
    }
  }
}