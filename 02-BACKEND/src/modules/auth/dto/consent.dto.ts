import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * Consent DTOs (contracts/consent.md, Consent policy §4/§5).
 *
 * The POST body carries the notice version identifiers the user is acknowledging
 * plus the three separate acknowledgments (Consent §4 — never preselected, each
 * must be explicitly true). The record MUST NOT contain assessment answers
 * or copied notice text (Consent §5); only version ids + language + channel + ts.
 */
export class NoticesQueryDto {
  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';
}

export class AcknowledgmentsDto {
  @IsBoolean()
  service_boundary!: boolean;

  @IsBoolean()
  terms!: boolean;

  @IsBoolean()
  privacy_notice!: boolean;
}

export class RecordConsentDto {
  @IsString()
  @IsNotEmpty()
  service_boundary_version!: string;

  @IsString()
  @IsNotEmpty()
  terms_version!: string;

  @IsString()
  @IsNotEmpty()
  privacy_notice_version!: string;

  @Type(() => AcknowledgmentsDto)
  @ValidateNested()
  acknowledgments!: AcknowledgmentsDto;

  @IsIn(['ar', 'en'])
  consent_language_code!: 'ar' | 'en';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  product_channel_id: string = 'priora-mind-web';
}

/** Bilingual text/link pair (contracts/consent.md GET /onboarding/notices). */
export interface BilingualEntry {
  en: string;
  ar: string;
}

export interface NoticesResponse {
  service_boundary_version: string;
  terms_version: string;
  privacy_notice_version: string;
  service_boundary_text: BilingualEntry;
  terms_link: BilingualEntry;
  privacy_notice_link: BilingualEntry;
  required_acknowledgments: ['service_boundary', 'terms', 'privacy_notice'];
}

export interface VersionSet {
  service_boundary_version: string;
  terms_version: string;
  privacy_notice_version: string;
}

export interface ConsentStatusResponse {
  has_granted: boolean;
  requires_reconsent: boolean;
  current_versions: VersionSet;
  recorded_versions: VersionSet | null;
  consent_language_code: 'ar' | 'en' | null;
}

export interface RecordConsentResponse {
  consent_record_id: string;
  granted_at: string;
  onboarding_state: 'IN_PROGRESS';
  next: '/onboarding/profile';
}
