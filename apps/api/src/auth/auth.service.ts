import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OtpRequestResponse } from '@sanad/api-client';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { ApiError } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { DbService } from '../db/db.service.js';
import { otpChallenges, trustProfiles, users } from '../db/schema.js';
import { DEFAULT_TEMPLATES, render } from '../notifications/templates.js';
import { SMS_PROVIDER, type SmsProvider } from '../providers/messaging.provider.js';
import { TokensService, type TokenPair } from './tokens.service.js';

/** Kuwait mobile numbers: +965 followed by 8 digits starting with 4, 5, 6 or 9. */
export const KUWAIT_PHONE = /^\+965[4569]\d{7}$/;

export type OtpPurpose = 'LOGIN' | 'CONTRACT_SIGN';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 5;

export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s()-]/g, '');
  const withPlus = digits.startsWith('00')
    ? `+${digits.slice(2)}`
    : digits.startsWith('+')
      ? digits
      : `+965${digits}`;
  if (!KUWAIT_PHONE.test(withPlus))
    throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_PHONE', 'enter a Kuwaiti mobile number');
  return withPlus;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
    private readonly clock: ClockService,
    private readonly tokens: TokensService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Dev-only: this phone may sign in without an SMS code (never true in production). */
  private isDevLoginPhone(phone: string): boolean {
    return this.env.DEV_ENDPOINTS && this.env.DEV_LOGIN_PHONES.includes(phone);
  }

  private isReviewPhone(phone: string): boolean {
    return Boolean(
      this.env.REVIEW_PHONE && this.env.REVIEW_CODE && this.env.REVIEW_PHONE === phone,
    );
  }

  private codeHash(phone: string, code: string): string {
    return this.crypto.blindIndex(`otp:${phone}:${code}`);
  }

  /**
   * Sends a sign-in code. While SMS is mocked (until Phase 7) and dev endpoints are on, the
   * response also carries the code (`devCode`) so the app can show it, and allow-listed phones
   * get `devLogin: true` (sign in via POST /auth/dev-login, no code). Both are off in production.
   */
  async requestOtp(rawPhone: string, language: 'ar' | 'en' = 'ar'): Promise<OtpRequestResponse> {
    const phone = normalizePhone(rawPhone);
    if (this.isDevLoginPhone(phone)) return { expiresIn: OTP_TTL_MS / 1000, devLogin: true };
    // Store review account: no SMS; the reviewer types the fixed REVIEW_CODE.
    if (this.isReviewPhone(phone)) return { expiresIn: OTP_TTL_MS / 1000 };
    return this.issueCode(phone, 'LOGIN', 'auth.otp', language);
  }

  /**
   * Create and SMS a one-time code for a purpose (LOGIN, CONTRACT_SIGN). Rate limited per phone
   * across purposes. In development the code is also returned (`devCode`) because SMS is mocked.
   */
  async issueCode(
    phone: string,
    purpose: OtpPurpose,
    template: string,
    language: 'ar' | 'en',
  ): Promise<OtpRequestResponse> {
    if (this.isReviewPhone(phone)) return { expiresIn: OTP_TTL_MS / 1000 };
    const hourAgo = new Date(this.clock.now().getTime() - 3_600_000);
    const [recent] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(and(eq(otpChallenges.phone, phone), gt(otpChallenges.createdAt, hourAgo)));
    if ((recent?.n ?? 0) >= OTP_MAX_PER_HOUR) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'OTP_RATE_LIMIT',
        'too many codes requested; try again later',
      );
    }
    const code = this.crypto.numericCode(6);
    await this.dbs.db.insert(otpChallenges).values({
      phone,
      purpose,
      codeHash: this.codeHash(phone, code),
      expiresAt: new Date(this.clock.now().getTime() + OTP_TTL_MS),
      createdAt: this.clock.now(),
    });
    const tpl = DEFAULT_TEMPLATES[template]!;
    await this.sms.send(phone, render(tpl[language].body, { code }));
    return this.env.DEV_ENDPOINTS
      ? { expiresIn: OTP_TTL_MS / 1000, devCode: code }
      : { expiresIn: OTP_TTL_MS / 1000 };
  }

  /** Check and consume a code; returns the challenge id (kept as the OTP reference). */
  async consumeCode(phone: string, purpose: OtpPurpose, code: string): Promise<string> {
    if (this.isReviewPhone(phone)) {
      if (
        this.crypto.safeEqual(
          this.codeHash(phone, code),
          this.codeHash(phone, this.env.REVIEW_CODE ?? ''),
        )
      )
        return 'store-review-account';
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'the code is invalid or expired');
    }
    const invalid = new ApiError(
      HttpStatus.UNAUTHORIZED,
      'INVALID_CODE',
      'the code is invalid or expired',
    );
    const [challenge] = await this.dbs.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phone, phone),
          eq(otpChallenges.purpose, purpose),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, this.clock.now()),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) throw invalid;
    if (!this.crypto.safeEqual(challenge.codeHash, this.codeHash(phone, code))) {
      await this.dbs.db
        .update(otpChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(otpChallenges.id, challenge.id));
      throw invalid;
    }
    await this.dbs.db
      .update(otpChallenges)
      .set({ consumedAt: this.clock.now() })
      .where(eq(otpChallenges.id, challenge.id));
    return challenge.id;
  }

  /** Dev-only sign-in without a code for DEV_LOGIN_PHONES. 404 when dev endpoints are off. */
  async devLogin(rawPhone: string): Promise<TokenPair & { userId: string; isNew: boolean }> {
    if (!this.env.DEV_ENDPOINTS) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'not found');
    const phone = normalizePhone(rawPhone);
    if (!this.isDevLoginPhone(phone))
      throw new ApiError(HttpStatus.FORBIDDEN, 'DEV_LOGIN_NOT_ALLOWED', 'use the SMS code');
    return this.signIn(phone);
  }

  async verifyOtp(
    rawPhone: string,
    code: string,
  ): Promise<TokenPair & { userId: string; isNew: boolean }> {
    const phone = normalizePhone(rawPhone);
    await this.consumeCode(phone, 'LOGIN', code);
    return this.signIn(phone);
  }

  /** Find or create the member for a verified phone and issue tokens. */
  private async signIn(phone: string): Promise<TokenPair & { userId: string; isNew: boolean }> {
    let isNew = false;
    let [user] = await this.dbs.db.select().from(users).where(eq(users.phone, phone));
    if (!user) {
      isNew = true;
      [user] = await this.dbs.db.insert(users).values({ phone }).returning();
      await this.dbs.db.insert(trustProfiles).values({ userId: user!.id }).onConflictDoNothing();
    }
    if (user!.status === 'DELETED')
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_DELETED', 'this account was deleted');
    const pair = await this.tokens.issue('member', user!.id);
    return { ...pair, userId: user!.id, isNew };
  }
}
