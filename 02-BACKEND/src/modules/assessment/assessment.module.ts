import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { AssessmentController } from './controllers/assessment.controller';
import { AssessmentDeletionService } from './services/assessment-deletion.service';
import { AssessmentAnswerStore } from './services/assessment-answer-store.service';
import { AssessmentLifecycleService } from './services/assessment-lifecycle.service';
import { AssessmentResultService } from './services/assessment-result.service';
import { AssessmentSubmitService } from './services/assessment-submit.service';
import { ScoringService } from './services/scoring.service';
import { SaveAnswerBodyPipe } from './dto/save-answer-body.pipe';

/**
 * Assessment feature module (US4–US5). Owns Assessment / AssessmentAnswer /
 * AssessmentResult + deterministic scoring (data-model §8–§10, contracts/
 * assessment.md). Imports AuthModule for ConsentService (consent gate, no
 * cross-module table access — SAD §11) and ProfileModule for the OnboardingGuard
 * (T033, the journey-ordering authority). AssessmentDeletionService is exported
 * concretely for the RetentionModule.
 */
@Module({
  imports: [AuthModule, ProfileModule],
  controllers: [AssessmentController],
  providers: [
    ScoringService,
    AssessmentAnswerStore,
    AssessmentLifecycleService,
    AssessmentResultService,
    AssessmentSubmitService,
    AssessmentDeletionService,
    SaveAnswerBodyPipe,
  ],
  exports: [AssessmentDeletionService, AssessmentResultService],
})
export class AssessmentModule {}
