import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
/** Cutoffs for scheduled coaching retention (none today). */
export interface CoachingCutoffs {
  completedBefore?: Date;
}

/** Sanitized integer counters returned by every deletion path. */
export interface DeletionCategoryCounters {
  deleted: number;
  errors: number;
}


@Injectable()
export class CoachingDeletionService {
  private readonly logger = new Logger(CoachingDeletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async deleteExpired(_cutoffs: CoachingCutoffs): Promise<DeletionCategoryCounters> {
    return { deleted: 0, errors: 0 };
  }

  async deleteCoachingForUsers(userIds: string[]): Promise<DeletionCategoryCounters> {
    if (userIds.length === 0) return { deleted: 0, errors: 0 };
    try {
      const res = await this.prisma.coachingPlan.deleteMany({ where: { userId: { in: userIds } } });
      return { deleted: res.count, errors: 0 };
    } catch (err) {
      this.logger.warn(`coaching-for-users deletion failed: ${err instanceof Error ? err.name : 'unknown'}`);
      return { deleted: 0, errors: 1 };
    }
  }
}
