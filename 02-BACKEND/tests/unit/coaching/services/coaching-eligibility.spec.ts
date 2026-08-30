import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CoachingEligibilityService } from '../../../../src/modules/coaching/services/coaching-eligibility.service';
import { ResultNotFoundException } from '../../../../src/modules/assessment/constants/assessment.errors';

const result = {
  resultId: 'result-1',
  assessmentId: 'assessment-1',
  definitionVersion: '1.0',
  domainScores: {},
  strongestDomain: 'stress',
  supportDomain: 'sleep',
  selectedPriorities: { domains: ['stress'], ranking: { stress: 1 } },
  goalFreeText: null,
};

function service({ state = 'COMPLETED', scored = result } = {}) {
  const prisma = { onboardingState: { findFirst: vi.fn().mockResolvedValue({ state }) } };
  const consent = { hasGrantedCurrentConsent: vi.fn().mockResolvedValue(true) };
  const guard = { assertCanEnter: vi.fn((route: string, ctx: { onboardingState: string }) => {
    if (route === 'dashboard' && ctx.onboardingState !== 'COMPLETED') throw new HttpException({ error: { code: 'ONBOARDING_STEP_BLOCKED' } }, 403);
  }) };
  const results = { getScoredResult: vi.fn().mockResolvedValue(scored) };
  return {
    eligibility: new CoachingEligibilityService(prisma as never, consent as never, guard as never, results as never),
    guard,
    results,
  };
}

describe('coaching eligibility rules', () => {
  it('allows completed users with a scored result', async () => {
    await expect(service().eligibility.assertEligible('user-1')).resolves.toEqual(result);
  });

  it('blocks incomplete users before checking the generation result', async () => {
    const { eligibility, results } = service({ state: 'ASSESSMENT_IN_PROGRESS' });
    await expect(eligibility.assertEligible('user-1')).rejects.toBeInstanceOf(HttpException);
    expect(results.getScoredResult).not.toHaveBeenCalled();
  });

  it('returns RESULT_NOT_FOUND when no scored result exists', async () => {
    await expect(service({ scored: null }).eligibility.assertEligible('user-1')).rejects.toBeInstanceOf(ResultNotFoundException);
  });
});