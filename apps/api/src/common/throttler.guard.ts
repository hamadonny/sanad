import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limit per signed-in session instead of per IP when a token is present. Kuwaiti mobile
 * carriers put many customers behind one IP (carrier-grade NAT), so IP-only limits would block
 * honest members at busy times. Unauthenticated routes (sign-in, telemetry) stay per IP.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined> | undefined;
    const auth = headers?.authorization;
    if (auth?.startsWith('Bearer ') && auth.length > 20)
      return `s:${createHash('sha256').update(auth).digest('hex').slice(0, 32)}`;
    return `ip:${String(req.ip ?? 'unknown')}`;
  }
}
