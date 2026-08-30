import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Auth DTOs (contracts/auth.md). Passwords are validated structurally; the
 * submitted value is NEVER echoed back in a validation error (the global
 * ValidationPipe emits field paths only).
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  consent_language_code?: 'ar' | 'en';
}

export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  // Lenient on login: a single-character policy keeps the 401 uniform regardless
  // of whether the email exists (anti-enumeration, FR-004).
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  userId!: string;
}

/** Anti-enumeration response bodies (FR-004). Identical whether or not the account exists. */
export const REGISTER_ACK_MESSAGE =
  'If this email is not already registered, a verification email has been sent.';
export const RESEND_ACK_MESSAGE =
  'If the email is registered and unverified, a new verification link has been sent.';

export interface RegisterResponse {
  message: string;
}

export interface VerifyEmailResponse {
  status: 'verified';
  redirect: string;
}

export interface LoginProfile {
  /** Placeholder until US3 reads the real OnboardingState row. */
  onboarding_state: 'NOT_STARTED';
  language_code: string | null;
}

export interface LoginResponse {
  accessToken: string;
  profile: LoginProfile;
}

export interface RefreshResponse {
  accessToken: string;
}