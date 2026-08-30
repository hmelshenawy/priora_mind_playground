import type { CoachingLibraryContent } from '../constants/coaching-library';
import type { GroundingBundle, LlmPlanOutput } from '../coaching-llm.types';

export interface PlanValidationResult {
  valid: boolean;
  reasons: string[];
}

/** JSON schema sent to the provider for structured coaching-plan output. */
const bilingual = {
  type: 'object', additionalProperties: false, required: ['en', 'ar'],
  properties: { en: { type: 'string', minLength: 1 }, ar: { type: 'string', minLength: 1 } },
};

export const COACHING_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['version', 'title', 'summary', 'focusAreas', 'goals', 'actions', 'disclaimerReference'],
  properties: {
    version: { type: 'string', minLength: 1 }, title: bilingual, summary: bilingual,
    focusAreas: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['domain', 'source', 'reason'], properties: { domain: { type: 'string' }, source: { type: 'string' }, reason: bilingual } } },
    goals: { type: 'array', minItems: 1, maxItems: 9, items: { type: 'object', additionalProperties: false, required: ['libraryKey'], properties: { libraryKey: { type: 'string', minLength: 1 } } } },
    actions: { type: 'array', minItems: 1, maxItems: 18, items: { type: 'object', additionalProperties: false, required: ['libraryKey', 'position', 'pacingLabel', 'copy'], properties: { libraryKey: { type: 'string', minLength: 1 }, position: { type: 'number' }, pacingLabel: bilingual, copy: bilingual } } },
    citations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['chunk_id', 'source_id', 'text_hash'], properties: { chunk_id: { type: 'string' }, source_id: { type: 'string' }, text_hash: { type: 'string' } } } },
    disclaimerReference: { type: 'object', additionalProperties: false, required: ['version'], properties: { version: { type: 'string' } } },
  },
};

function bilingualValue(value: unknown): boolean {
  const item = value as { en?: unknown; ar?: unknown };
  return Boolean(item && typeof item.en === 'string' && item.en.trim() && typeof item.ar === 'string' && item.ar.trim());
}

/** Structural validation of the parsed provider output before semantic validation. */
export function isPlanOutput(value: unknown): value is LlmPlanOutput {
  const output = value as Partial<LlmPlanOutput>;
  return Boolean(output && output.version === '1.0' && bilingualValue(output.title) && bilingualValue(output.summary)
    && Array.isArray(output.focusAreas) && output.focusAreas.length > 0
    && output.focusAreas.every((area) => typeof area?.domain === 'string' && bilingualValue(area.reason))
    && Array.isArray(output.goals) && output.goals.length > 0 && output.goals.every((goal) => typeof goal?.libraryKey === 'string')
    && Array.isArray(output.actions) && output.actions.length > 0
    && output.actions.every((action) => typeof action?.libraryKey === 'string' && Number.isInteger(action.position) && bilingualValue(action.copy) && (action.pacingLabel === null || bilingualValue(action.pacingLabel)))
    && typeof output.disclaimerReference?.version === 'string');
}

const blockedTerms = [/diagnos/i, /medicat/i, /suicide/i, /crisis/i, /emergency/i];

function hasText(v: { en?: string; ar?: string } | null | undefined): boolean {
  return Boolean(v?.en?.trim() && v?.ar?.trim());
}

function libraryKeys(library: CoachingLibraryContent): Set<string> {
  const keys = new Set<string>();
  for (const domain of library.domains) {
    for (const goal of domain.goals) {
      keys.add(goal.libraryKey);
      for (const action of goal.actions) keys.add(action.libraryKey);
    }
  }
  return keys;
}

function focusEvidence(bundle: GroundingBundle): Set<string> {
  return new Set(bundle.focusAreaEvidence.map((area) => area.domain));
}

function duplicateValues(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateLlmPlanOutput(
  output: LlmPlanOutput,
  bundle: GroundingBundle,
): PlanValidationResult {
  const reasons: string[] = [];
  const keys = libraryKeys(bundle.library);
  const evidence = focusEvidence(bundle);
  if (output.version !== '1.0') reasons.push('UNSUPPORTED_OUTPUT_VERSION');
  if (!hasText(output.title)) reasons.push('TITLE_BILINGUAL_REQUIRED');
  if (!hasText(output.summary)) reasons.push('SUMMARY_BILINGUAL_REQUIRED');
  if (!output.focusAreas.length) reasons.push('FOCUS_AREA_REQUIRED');
  if (output.focusAreas.length > 3) reasons.push('FOCUS_AREA_LIMIT');
  if (duplicateValues(output.focusAreas.map((area) => area.domain))) reasons.push('DUPLICATE_FOCUS_AREA');
  if (!output.goals.length) reasons.push('GOAL_REQUIRED');
  if (output.goals.length > 9) reasons.push('GOAL_LIMIT');
  if (duplicateValues(output.goals.map((goal) => goal.libraryKey))) reasons.push('DUPLICATE_GOAL_LIBRARY_KEY');
  if (!output.actions.length) reasons.push('ACTION_REQUIRED');
  if (output.actions.length > 18) reasons.push('ACTION_LIMIT');
  if (duplicateValues(output.actions.map((action) => action.libraryKey))) reasons.push('DUPLICATE_ACTION_LIBRARY_KEY');
  for (const area of output.focusAreas) {
    if (!hasText(area.reason)) reasons.push('FOCUS_REASON_BILINGUAL_REQUIRED');
    if (!evidence.has(area.domain)) reasons.push('UNSUPPORTED_FOCUS_AREA');
    if (!['priority', 'support', 'lowest_band'].includes(area.source)) reasons.push('UNSUPPORTED_FOCUS_SOURCE');
  }
  for (const goal of output.goals) {
    if (!keys.has(goal.libraryKey)) reasons.push('UNKNOWN_GOAL_LIBRARY_KEY');
    if (!goal.libraryKey.trim()) reasons.push('GOAL_LIBRARY_KEY_REQUIRED');
  }
  for (const action of output.actions) {
    if (!keys.has(action.libraryKey)) reasons.push('UNKNOWN_ACTION_LIBRARY_KEY');
    if (!hasText(action.copy)) reasons.push('ACTION_COPY_BILINGUAL_REQUIRED');
    if (!Number.isInteger(action.position) || action.position < 1) reasons.push('ACTION_POSITION_INVALID');
    if (action.pacingLabel !== null && !hasText(action.pacingLabel)) reasons.push('ACTION_PACING_BILINGUAL_REQUIRED');
  }
  if (bundle.ragContext) {
    const allowed = new Map(bundle.ragContext.chunks.map((chunk) => [chunk.chunk_id, chunk]));
    for (const citation of output.citations ?? []) {
      const chunk = allowed.get(citation.chunk_id);
      if (!chunk) reasons.push('UNKNOWN_RAG_CITATION');
      if (chunk && (chunk.source_id !== citation.source_id || chunk.text_hash !== citation.text_hash)) reasons.push('RAG_CITATION_METADATA_MISMATCH');
    }
  }
  const rendered = JSON.stringify(output);
  if (blockedTerms.some((term) => term.test(rendered))) reasons.push('CONCERNING_OUTPUT');
  if (output.disclaimerReference.version !== bundle.disclaimerVersion) reasons.push('DISCLAIMER_VERSION_MISMATCH');
  if (!bundle.library.domains.length) reasons.push('LIBRARY_EMPTY');
  return { valid: reasons.length === 0, reasons };
}
