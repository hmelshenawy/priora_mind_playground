import { type DomainCode } from '../constants/assessment-definition';
import type { ResultInsight } from './result-presenter';

/**
 * Assessment DTOs (contracts/assessment.md, FR-013..FR-016, FR-037). Answer
 * bodies are validated by `SaveAnswerBodyPipe` + the per-kind answer DTO
 * classes in `dto/answer-value.dto.ts` (selected by the `question_id` route
 * param), producing 400 VALIDATION with field paths — never the submitted
 * value. Cross-question consistency (AG-02 ranks cover AG-01 selection; AG-03
 * goals cover AG-01 selection) is enforced in the lifecycle service against
 * the saved AG-01 answer.
 *
 * Scope: the 16 current-state questions + AG-01..AG-05.
 */

// ── response shapes ────────────────────────────────────────────────

export interface AnsweredItem {
  question_id: string;
  value: unknown;
}

export interface AssessmentView {
  assessment_id: string;
  definition_version: string;
  assessment_state: string;
  next_question_id: string | null;
  answered: AnsweredItem[];
  introduction: { en: string; ar: string };
  /** US8 (FR-034, SC-007): present (true) when the active assessment's definition
   * version no longer matches the current definition AND the user has saved
   * answers — i.e. the saved progress is inconsistent/corrupt. The system offers
   * a safe restart instead of resuming stale answers; no partial result is
   * presented as complete. Absent on the healthy resume / NORMAL path. */
  requires_safe_restart?: boolean;
}

export interface DefinitionQuestion {
  id: string;
  domain: DomainCode;
  polarity: 'P' | 'N';
  scale: { en: string[]; ar: string[] };
  required: boolean;
  en: string;
  ar: string;
}
export interface DefinitionResponse {
  version: string;
  instruction: { en: string; ar: string };
  questions: DefinitionQuestion[];
  goal_questions: {
    id: string;
    kind: string;
    required: boolean;
    prompt_en: string;
    prompt_ar: string;
  }[];
  band_thresholds: { min: number; max: number; label_en: string; label_ar: string }[];
  /** Canonical bilingual domain labels (single source of truth — assessment-definition).
   * The frontend renders AG-01 area selection + result domain names from these so
   * EN/AR never drift (Constitution X). */
  domain_labels: { en: Record<DomainCode, string>; ar: Record<DomainCode, string> };
}

export interface SaveAnswerResponse {
  saved: true;
  assessment_state: string;
  next_question_id: string | null;
}

export interface SubmitResponse {
  result_id: string;
  assessment_state: 'SCORED';
  /** The NORMAL path completes onboarding when the result is presented
   * (data-model §7 line 151). */
  onboarding_state: 'COMPLETED';
  /** The non-diagnostic coaching insight (US5 presenter, FR-017/FR-018). */
  result: ResultInsight;
  next: '/assessment/result';
  duplicate?: boolean;
}

export interface ResultDomainScore {
  domain: DomainCode;
  score: number;
  band: { label_en: string; label_ar: string };
}
export interface ResultResponse {
  result_id: string;
  definition_version: string;
  domain_scores: ResultDomainScore[];
  strongest_domain: DomainCode;
  support_domain: DomainCode;
  selected_priorities: { domains: DomainCode[]; ranking: Record<string, number> };
  goal_free_text: Record<string, unknown> | null;
}

export interface ScoredResultDto {
  resultId: string;
  assessmentId: string;
  definitionVersion: string;
  domainScores: Record<string, unknown>;
  strongestDomain: DomainCode;
  supportDomain: DomainCode;
  selectedPriorities: { domains: DomainCode[]; ranking: Record<string, number> };
  goalFreeText: Record<string, unknown> | null;
}
