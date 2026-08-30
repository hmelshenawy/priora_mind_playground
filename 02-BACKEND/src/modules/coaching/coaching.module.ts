import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AssessmentModule } from '../assessment/assessment.module';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { RagModule } from '../rag/rag.module';
import { CoachingController } from './controllers/coaching.controller';
import { CoachingActionService } from './services/coaching-action.service';
import { CoachingDeletionService } from './services/coaching-deletion.service';
import { CoachingEligibilityService } from './services/coaching-eligibility.service';
import { CoachingGenerationService } from './services/coaching-generation.service';
import { CoachingGroundingService } from './services/coaching-grounding.service';
import { CoachingPlanService } from './services/coaching-plan.service';

@Module({
  imports: [AuthModule, ProfileModule, AssessmentModule, AiModule, RagModule],
  controllers: [CoachingController],
  providers: [
    CoachingEligibilityService,
    CoachingGroundingService,
    CoachingGenerationService,
    CoachingPlanService,
    CoachingActionService,
    CoachingDeletionService,
  ],
  exports: [CoachingDeletionService],
})
export class CoachingModule {}
