import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../../modules/auth/tokens/jwt-token.service';

/**
 * Authenticated user payload (set on `req.user` by JwtAuthGuard). Replaces the
 * `req.user as JwtPayload` cast at every controller call site.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as JwtPayload;
});