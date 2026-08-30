import { Prisma } from '@prisma/client';
import {
  type DomainCode,
} from '../constants/assessment-definition';
import {
  type ResultDomainScore,
  type ResultResponse,
  type ScoredResultDto,
} from '../dto/assessment.dto';

/**
 * Pure result-mapping helpers extracted from AssessmentSubmitService (Constitution
 * VIII — handwritten files MUST NOT exceed 300 lines). These functions hold NO
 * state and take only their explicit inputs: they project saved-answer rows onto
 * the shapes the scorer/classifier/presenter consume, and map a stored result row
 * back onto the typed `ResultResponse`. Kept pure so submit owns orchestration and
 * this module owns shape translation (single responsibility).
 *
 * None of these functions read or emit sensitive content beyond what their caller
 * already holds in memory; no logging happens here (FR-030).
 */

/** A saved-answer row as read from persistence (loosely typed value). */
export interface SavedAnswer {
  questionId: string;
  value: unknown;
}

/** A stored result row (JSON fields typed loosely — Prisma returns JsonValue, the
 *  mock returns unknown) onto which the typed ResultResponse is mapped. */
export interface StoredResultRow {
  id: string;
  assessmentId?: string;
  definitionVersion: string;
  domainScores: unknown;
  strongestDomain: string;
  supportDomain: string;
  selectedPriorities: unknown;
  goalFreeText: unknown;
}

/** Nullable JSON input: Prisma requires Prisma.JsonNull (not JS null) for a NULL
 *  value on a `Json?` field; a non-null object is cast to InputJsonValue. */
export function goalFreeTextInput(
  v: Record<string, unknown> | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return v ? (v as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
}

/** Collect the numeric current-state answers (AS-* questions) for the scorer. */
export function extractCurrentState(answers: SavedAnswer[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of answers) {
    if (!a.questionId.startsWith('AS-')) continue;
    const v = (a.value as { value?: number } | undefined)?.value;
    if (typeof v === 'number') out[a.questionId] = v;
  }
  return out;
}

/** Collect the AG-01 domain selection + AG-02 ranking as "selected priorities". */
export function collectPriorities(answers: SavedAnswer[]): {
  domains: DomainCode[];
  ranking: Record<string, number>;
} {
  const ag01 = answers.find((a) => a.questionId === 'AG-01');
  const ag02 = answers.find((a) => a.questionId === 'AG-02');
  const domains = ((ag01?.value as { domains?: DomainCode[] } | undefined)?.domains) ?? [];
  const ranking = ((ag02?.value as { ranking?: Record<string, number> } | undefined)?.ranking) ?? {};
  return { domains, ranking };
}

export function collectGoalFreeText(answers: SavedAnswer[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const ag03 = answers.find((a) => a.questionId === 'AG-03');
  const ag04 = answers.find((a) => a.questionId === 'AG-04');
  const ag05 = answers.find((a) => a.questionId === 'AG-05');
  if (ag03) out['AG-03'] = (ag03.value as { goals?: unknown }).goals ?? ag03.value;
  if (ag04) out['AG-04'] = (ag04.value as { text?: unknown }).text ?? ag04.value;
  if (ag05) out['AG-05'] = ag05.value;
  return Object.keys(out).length ? out : null;
}

/** Map a stored result row onto the typed ResultResponse. Casts are safe: the row
 *  was authored by the submit service from the typed ScoredAssessment + priorities. */
export function toResultResponse(row: StoredResultRow): ResultResponse {
  const domainScores = row.domainScores as Record<
    DomainCode,
    { score: number; band: { label_en: string; label_ar: string } }
  >;
  const domain_scores: ResultDomainScore[] = Object.entries(domainScores).map(
    ([domain, v]) => ({
      domain: domain as DomainCode,
      score: v.score,
      band: { label_en: v.band.label_en, label_ar: v.band.label_ar },
    }),
  );
  return {
    result_id: row.id,
    definition_version: row.definitionVersion,
    domain_scores,
    strongest_domain: row.strongestDomain as DomainCode,
    support_domain: row.supportDomain as DomainCode,
    selected_priorities: row.selectedPriorities as {
      domains: DomainCode[];
      ranking: Record<string, number>;
    },
    goal_free_text: (row.goalFreeText as Record<string, unknown> | null) ?? null,
  };
}

export function toScoredResultDto(row: StoredResultRow & { assessmentId: string }): ScoredResultDto {
  return {
    resultId: row.id,
    assessmentId: row.assessmentId,
    definitionVersion: row.definitionVersion,
    domainScores: row.domainScores as Record<string, unknown>,
    strongestDomain: row.strongestDomain as DomainCode,
    supportDomain: row.supportDomain as DomainCode,
    selectedPriorities: row.selectedPriorities as { domains: DomainCode[]; ranking: Record<string, number> },
    goalFreeText: (row.goalFreeText as Record<string, unknown> | null) ?? null,
  };
}
