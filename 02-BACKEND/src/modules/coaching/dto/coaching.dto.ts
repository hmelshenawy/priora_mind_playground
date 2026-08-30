import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type {
  AcceptPlanResponse,
  ActionStatus,
  Bilingual,
  CoachingGenerationStatus,
  CoachingPlanProgress,
  CoachingPlanResponse,
  CoachingPlanStatus,
  GenerationStatusResponse,
  UpdateActionBody,
} from '@priora/shared-types';

export class UpdateActionDto {
  @IsIn(['INCOMPLETE', 'COMPLETE'])
  status!: 'INCOMPLETE' | 'COMPLETE';

  @IsOptional()
  @IsInt()
  @Min(1)
  expected_version?: number;
}

export interface UpdateActionResponse {
  action: { id: string; status: ActionStatus; version: number };
  progress: CoachingPlanProgress;
  plan_status: CoachingPlanStatus;
}

export type {
  AcceptPlanResponse,
  Bilingual,
  CoachingGenerationStatus,
  CoachingPlanProgress,
  CoachingPlanResponse,
  CoachingPlanStatus,
  GenerationStatusResponse,
  UpdateActionBody,
};