import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../../auth/guards/email-verified.guard';
import type { JwtPayload } from '../../auth/tokens/jwt-token.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SaveAnswerBodyPipe } from '../dto/save-answer-body.pipe';
import { AssessmentLifecycleService } from '../services/assessment-lifecycle.service';
import { AssessmentSubmitService } from '../services/assessment-submit.service';

/**
 * Assessment endpoints (contracts/assessment.md, FR-013..FR-018). Security posture
 * mirrors the profile module:
 *  - Every route requires a valid access token (JwtAuthGuard) AND EMAIL_VERIFIED
 *    (EmailVerifiedGuard) — backend-enforced (FR-002, FR-027/FR-028).
 *  - The OnboardingGuard (T033) additionally requires granted consent before any
 *    step (the services build the guard context + assert 'assessment') — FR-006.
 *  - All writes filter by `req.user.sub` server-side; route guards are UX only
 *    (FR-028). No submitted value is echoed; validation errors carry field paths
 *    only (FR-037) — SaveAnswerBodyPipe validates each answer body against the
 *    per-kind DTO selected by `question_id`, throwing the shared 400 VALIDATION
 *    error shape.
 */
@Controller()
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class AssessmentController {
  constructor(
    private readonly lifecycle: AssessmentLifecycleService,
    private readonly submitService: AssessmentSubmitService,
  ) {}

  @Get('assessment')
  @HttpCode(200)
  getAssessment(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.lifecycle.getAssessment(user.sub);
  }

  @Get('assessment/definition')
  @HttpCode(200)
  getDefinition() {
    return this.lifecycle.getDefinition();
  }

  @Put('assessment/answers/:question_id')
  @HttpCode(200)
  saveAnswer(
    @CurrentUser() user: JwtPayload,
    @Param('question_id') questionId: string,
    // The request-scoped pipe reads `question_id` from the current request and
    // validates this body against the matching per-kind DTO.
    @Body(SaveAnswerBodyPipe) answer: unknown,
  ) {
    return this.lifecycle.saveAnswer(user.sub, questionId, answer);
  }

  @Post('assessment/restart')
  @HttpCode(204)
  async restart(@Req() req: Request) {
    const user = req.user as JwtPayload;
    await this.lifecycle.restart(user.sub);
  }

  @Post('assessment/submit')
  @HttpCode(200)
  submit(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.submitService.submit(user.sub);
  }

  @Get('assessment/result')
  @HttpCode(200)
  getResult(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.submitService.getResult(user.sub);
  }
}
