import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { REFRESH_COOKIE_NAME } from '../tokens/refresh-cookie.service';
import type { JwtPayload } from '../tokens/jwt-token.service';
import { AuthService } from '../services/auth.service';
import {
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  VerifyEmailQueryDto,
} from '../dto/auth.dto';

/**
 * Auth endpoints (contracts/auth.md). Base `/api/v1/auth` (global prefix applied).
 *
 * Security posture:
 *  - register/resend are anti-enumeration (identical responses, no delivery status).
 *  - login sets the refresh cookie (HttpOnly) and returns the in-memory access token.
 *  - refresh rotates via the cookie; logout requires an access token and revokes.
 *  - No sensitive value is ever echoed; validation errors carry field paths only.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(201)
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Post('resend-verification')
  @HttpCode(200)
  resend(@Body() body: ResendVerificationDto) {
    return this.auth.resendVerification(body);
  }

  @Get('verify-email')
  verify(@Query() query: VerifyEmailQueryDto) {
    return this.auth.verifyEmail(query);
  }

  @Post('login')
  @HttpCode(200)
  login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(body, res);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined, res);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as JwtPayload;
    const raw = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    return this.auth.logout(user.sub, raw, res);
  }
}