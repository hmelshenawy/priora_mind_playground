import type { LlmRequest, LlmResponse } from '../../src/modules/ai/llm.types';
import type { AiCoachingLibraryContent } from '../../src/modules/coaching/coaching-llm.types';

/** Deterministic fake of AiService.generate for coaching tests: synthesizes a
 *  valid bilingual plan using the first library goal/action of the bundle. */
export class FakeCoachingAi {
  calls = 0;

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls += 1;
    const input = JSON.parse(request.input) as { coachingLibrary: AiCoachingLibraryContent; disclaimerVersion: string };
    const domain = input.coachingLibrary.domains[0];
    const goal = domain?.goals[0];
    const action = goal?.actions[0];
    return {
      content: {
        version: '1.0',
        title: { en: 'Fixture coaching plan', ar: 'خطة توجيه تجريبية' },
        summary: { en: 'Fixture summary', ar: 'ملخص تجريبي' },
        focusAreas: domain ? [{ domain: domain.domain, source: 'priority', reason: { en: 'Fixture reason', ar: 'سبب تجريبي' } }] : [],
        goals: goal ? [{ libraryKey: goal.libraryKey }] : [],
        actions: action ? [{ libraryKey: action.libraryKey, position: 1, pacingLabel: action.pacingLabel ?? null, copy: action.copy }] : [],
        disclaimerReference: { version: input.disclaimerVersion },
      },
      usage: { prompt: 0, completion: 0, total: 0 },
      latencyMs: 0,
      modelId: 'fake-coaching-llm',
    };
  }
}