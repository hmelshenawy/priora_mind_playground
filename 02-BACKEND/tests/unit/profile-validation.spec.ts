import { describe, expect, it } from 'vitest';
import { isValidIanaTimezone } from '../../src/modules/profile/timezone.util';
import { PutProfileDto, PutLanguageDto } from '../../src/modules/profile/profile.dto';
import { validateDto } from '../helpers/dto-validate';

/**
 * T037 — Profile validation (FR-009/FR-010, data-model §6).
 *
 * Language is constrained to the two first-class locales {ar, en}; timezone MUST
 * be a known IANA name (FR-009). The DTOs run through the global ValidationPipe
 * (the same one main.ts installs) so the contract layer can trust it to reject
 * bad input with field paths only (FR-037).
 */
describe('Profile validation (US3)', () => {
  describe('isValidIanaTimezone', () => {
    it('accepts well-known IANA zones', () => {
      expect(isValidIanaTimezone('Africa/Cairo')).toBe(true);
      expect(isValidIanaTimezone('America/New_York')).toBe(true);
      expect(isValidIanaTimezone('Europe/London')).toBe(true);
      expect(isValidIanaTimezone('Asia/Dubai')).toBe(true);
      expect(isValidIanaTimezone('UTC')).toBe(true);
    });

    it('rejects non-IANA strings', () => {
      expect(isValidIanaTimezone('Not/A/Zone')).toBe(false);
      expect(isValidIanaTimezone('Egypt')).toBe(false); // country, not a zone
      expect(isValidIanaTimezone('')).toBe(false);
      expect(isValidIanaTimezone('  America/New_York  ')).toBe(false); // whitespace
      expect(isValidIanaTimezone(123 as unknown as string)).toBe(false);
      expect(isValidIanaTimezone(undefined as unknown as string)).toBe(false);
    });
  });

  describe('PutProfileDto', () => {
    it('accepts a valid language + IANA timezone', async () => {
      const out = await validateDto(PutProfileDto, { language_code: 'ar', timezone: 'Africa/Cairo' });
      expect(out.language_code).toBe('ar');
    });

    it('rejects an invalid language with a language_code path, no value echo', async () => {
      await expect(validateDto(PutProfileDto, { language_code: 'fr', timezone: 'UTC' })).rejects.toThrow(
        /VALIDATION|language_code/,
      );
      const err = await validateDto(PutProfileDto, { language_code: 'fr', timezone: 'UTC' }).catch(
        (e) => e,
      );
      const body = JSON.stringify(err.getResponse());
      expect(err.status).toBe(400);
      expect(body).toContain('language_code');
      expect(body).not.toContain('fr');
    });

    it('rejects an invalid timezone with a timezone field path (FR-037)', async () => {
      const err = await validateDto(PutProfileDto, {
        language_code: 'en',
        timezone: 'Not/A/Zone',
      }).catch((e) => e);
      const response = err.getResponse() as { error: { fields: { path: string; message: string }[] } };
      expect(response.error.fields[0].path).toBe('timezone');
      expect(response.error.fields[0].message).toBe('INVALID_TIMEZONE');
      expect(JSON.stringify(response)).not.toContain('Not/A/Zone');
    });

    it('rejects a missing timezone', async () => {
      await expect(validateDto(PutProfileDto, { language_code: 'en' })).rejects.toThrow();
    });

    it('rejects a missing language', async () => {
      await expect(validateDto(PutProfileDto, { timezone: 'UTC' })).rejects.toThrow();
    });
  });

  describe('PutLanguageDto', () => {
    it('accepts ar and en', async () => {
      expect((await validateDto(PutLanguageDto, { language_code: 'ar' })).language_code).toBe('ar');
      expect((await validateDto(PutLanguageDto, { language_code: 'en' })).language_code).toBe('en');
    });

    it('rejects other languages, empty strings, and empty payloads', async () => {
      await expect(validateDto(PutLanguageDto, { language_code: 'fr' })).rejects.toThrow();
      await expect(validateDto(PutLanguageDto, { language_code: '' })).rejects.toThrow();
      await expect(validateDto(PutLanguageDto, {})).rejects.toThrow();
    });
  });
});