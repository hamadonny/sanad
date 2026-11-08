import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { ApiError } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { DbService } from '../db/db.service.js';
import { refreshTokens } from '../db/schema.js';

export type SubjectType = 'member' | 'admin';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const ACCESS_TTL: Record<SubjectType, number> = { member: 15 * 60, admin: 30 * 60 };
const REFRESH_TTL_DAYS: Record<SubjectType, number> = { member: 30, admin: 1 };

const unauthorized = (message = 'not authenticated') =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);

/** Short-lived access JWTs + rotating opaque refresh tokens with reuse detection (spec §12). */
@Injectable()
export class TokensService {
  private readonly secrets: Record<SubjectType, Uint8Array>;

  constructor(
    @Inject(ENV) env: Env,
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
    private readonly clock: ClockService,
  ) {
    this.secrets = {
      member: new TextEncoder().encode(env.JWT_SECRET),
      admin: new TextEncoder().encode(env.ADMIN_JWT_SECRET),
    };
  }

  async issue(
    type: SubjectType,
    subjectId: string,
    extra: Record<string, unknown> = {},
    familyId: string = randomUUID(),
  ): Promise<TokenPair> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const accessToken = await new SignJWT(extra)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subjectId)
      .setAudience(type)
      .setIssuer('sanad')
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TTL[type])
      .sign(this.secrets[type]);
    const refreshToken = this.crypto.randomToken(32);
    await this.dbs.db.insert(refreshTokens).values({
      subjectType: type,
      subjectId,
      familyId,
      tokenHash: this.crypto.sha256(refreshToken),
      expiresAt: new Date(this.clock.now().getTime() + REFRESH_TTL_DAYS[type] * 86_400_000),
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL[type] };
  }

  async verifyAccess(
    type: SubjectType,
    token: string,
  ): Promise<{ sub: string; claims: Record<string, unknown> }> {
    try {
      const { payload } = await jwtVerify(token, this.secrets[type], {
        audience: type,
        issuer: 'sanad',
        currentDate: this.clock.now(),
      });
      if (!payload.sub) throw new Error('no subject');
      return { sub: payload.sub, claims: payload as Record<string, unknown> };
    } catch {
      throw unauthorized('invalid or expired token');
    }
  }

  /** Rotate: the old token is revoked; presenting a revoked token revokes the whole family. */
  async rotate(
    type: SubjectType,
    refreshToken: string,
    extra: (subjectId: string) => Promise<Record<string, unknown>> = async () => ({}),
  ): Promise<TokenPair> {
    const hash = this.crypto.sha256(refreshToken);
    const [row] = await this.dbs.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hash), eq(refreshTokens.subjectType, type)));
    if (!row) throw unauthorized('unknown refresh token');
    if (row.revokedAt) {
      await this.dbs.db
        .update(refreshTokens)
        .set({ revokedAt: this.clock.now() })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      throw unauthorized('refresh token reuse detected; please sign in again');
    }
    if (row.expiresAt < this.clock.now()) throw unauthorized('refresh token expired');
    const pair = await this.issue(type, row.subjectId, await extra(row.subjectId), row.familyId);
    const [next] = await this.dbs.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, this.crypto.sha256(pair.refreshToken)));
    await this.dbs.db
      .update(refreshTokens)
      .set({ revokedAt: this.clock.now(), replacedById: next?.id ?? null })
      .where(eq(refreshTokens.id, row.id));
    return pair;
  }

  async revokeFamilyOf(refreshToken: string): Promise<void> {
    const [row] = await this.dbs.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, this.crypto.sha256(refreshToken)));
    if (row)
      await this.dbs.db
        .update(refreshTokens)
        .set({ revokedAt: this.clock.now() })
        .where(eq(refreshTokens.familyId, row.familyId));
  }
}
