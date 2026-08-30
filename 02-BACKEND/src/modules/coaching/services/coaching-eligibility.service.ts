import { Injectable } from '@nestjs/common';
import { ConsentService } from '../../auth/services/consent.service';

import { OnboardingGuardService, type OnboardingGuardContext } from '../../profile/onboarding.guard';
import { AssessmentResultService } from '../../assessment/services/assessment-result.service';
import { ResultNotFoundException } from '../../assessment/constants/assessment.errors';
import type { ScoredResultDto } from '../../assessment/dto/assessment.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NoCurrentPlanException } from '../constants/coaching.errors';

type Db = Record<string, { [method: string]: (...args: unknown[]) => unknown }>;

@Injectable()
export class CoachingEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly guard: OnboardingGuardService,
    private readonly results: AssessmentResultService,
  ) {}

  get db(): Db {
    return this.prisma as unknown as Db;
  }

  async assertEligible(userId: string): Promise<ScoredResultDto> {
    const ctx = await this.contextFor(userId);
    this.guard.assertCanEnter('dashboard', ctx);
    const result = await this.results.getScoredResult(userId);
    if (!result) throw new ResultNotFoundException();
    return result;
  }

  async getCurrentResultOrNoPlan(userId: string): Promise<ScoredResultDto> {
    const result = await this.results.getScoredResult(userId);
    if (!result) throw new NoCurrentPlanException();
    return result;
  }

  private async contextFor(userId: string): Promise<OnboardingGuardContext> {
    const row = await this.db.onboardingState.findFirst({ where: { userId } }) as { state?: string } | null;
    return {
      userId,
      onboardingState: row?.state ?? 'NOT_STARTED',
      emailVerified: true,
      consentGranted: await this.consent.hasGrantedCurrentConsent(userId),
    };
  }
}
