import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, gte, sql } from 'drizzle-orm';
import { ClockService } from '../common/clock.service.js';
import { ENV, type Env } from '../config/env.js';
import { DbService } from '../db/db.service.js';
import { analyticsDaily, errorEvents } from '../db/schema.js';
import { scrub } from './scrub.js';

/** Only these anonymous events are counted (anything else is ignored). */
export const ANALYTICS_EVENTS = [
  'app_open',
  'onboarding_language',
  'otp_requested',
  'signed_in',
  'kyc_submitted',
  'join_viewed',
  'contract_signed',
  'payment_started',
  'payment_completed',
  'bid_placed',
  'addendum_confirmed',
  'draw_verified',
  'receipt_downloaded',
  'support_ticket',
] as const;

export interface ErrorInput {
  source: 'api' | 'mobile' | 'admin';
  message: string;
  stack?: string | null | undefined;
  context?: string | null | undefined;
  platform?: string | null | undefined;
  appVersion?: string | null | undefined;
}

/**
 * Self-hosted error monitoring and privacy-safe analytics. Data stays in Sanad's own database
 * (no third-party trackers; helps with data residency). Optional ALERT_WEBHOOK_URL gets a short
 * scrubbed message for new API errors (at most once per error type every 10 minutes).
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger('Telemetry');
  private readonly alerted = new Map<string, number>();

  constructor(
    private readonly dbs: DbService,
    private readonly clock: ClockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  static fingerprint(source: string, message: string, stack?: string | null): string {
    // Group by the error message without numbers/ids, plus the first stack frame.
    const norm = message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '#').replace(/\d+/g, '#');
    const frame = (stack ?? '').split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
    return createHash('sha1')
      .update(`${source}|${norm}|${frame.trim()}`)
      .digest('hex')
      .slice(0, 16);
  }

  async recordError(e: ErrorInput): Promise<void> {
    try {
      const message = scrub(e.message, 500) ?? 'unknown';
      const stack = scrub(e.stack, 4000);
      const fp = TelemetryService.fingerprint(e.source, message, stack);
      await this.dbs.db.insert(errorEvents).values({
        source: e.source,
        platform: scrub(e.platform, 20),
        appVersion: scrub(e.appVersion, 20),
        fingerprint: fp,
        message,
        stack,
        context: scrub(e.context, 200),
      });
      if (e.source === 'api') void this.alert(fp, message);
    } catch (err) {
      // Monitoring must never break the request that is failing.
      this.logger.warn(
        `could not record error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async alert(fp: string, message: string): Promise<void> {
    const url = this.env.ALERT_WEBHOOK_URL;
    if (!url) return;
    const now = this.clock.now().getTime();
    if ((this.alerted.get(fp) ?? 0) > now - 10 * 60_000) return;
    this.alerted.set(fp, now);
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Sanad API error [${fp}]: ${message}` }),
      });
    } catch {
      /* best effort */
    }
  }

  async track(
    events: { name: string; n?: number | undefined }[],
    platform: string,
    appVersion: string,
  ) {
    const day = this.clock.today();
    const allowed = new Set<string>(ANALYTICS_EVENTS);
    const plat = ['ios', 'android', 'web'].includes(platform) ? platform : 'other';
    const ver = /^[0-9A-Za-z.+-]{1,20}$/.test(appVersion) ? appVersion : 'unknown';
    const counts = new Map<string, number>();
    for (const e of events.slice(0, 100)) {
      if (!allowed.has(e.name)) continue;
      counts.set(e.name, (counts.get(e.name) ?? 0) + Math.min(Math.max(1, e.n ?? 1), 50));
    }
    for (const [event, n] of counts) {
      await this.dbs.db
        .insert(analyticsDaily)
        .values({ day, event, platform: plat, appVersion: ver, count: n })
        .onConflictDoUpdate({
          target: [
            analyticsDaily.day,
            analyticsDaily.event,
            analyticsDaily.platform,
            analyticsDaily.appVersion,
          ],
          set: { count: sql`${analyticsDaily.count} + ${n}` },
        });
    }
    return { accepted: [...counts.values()].reduce((a, b) => a + b, 0) };
  }

  /** Error groups for the dashboard (last `days` days). */
  async errorGroups(days = 7) {
    const since = new Date(this.clock.now().getTime() - days * 86_400_000);
    const rows = await this.dbs.db
      .select({
        fingerprint: errorEvents.fingerprint,
        source: errorEvents.source,
        message: sql<string>`(array_agg(${errorEvents.message} ORDER BY ${errorEvents.id} DESC))[1]`,
        stack: sql<
          string | null
        >`(array_agg(${errorEvents.stack} ORDER BY ${errorEvents.id} DESC))[1]`,
        context: sql<
          string | null
        >`(array_agg(${errorEvents.context} ORDER BY ${errorEvents.id} DESC))[1]`,
        platforms: sql<string[]>`array_remove(array_agg(DISTINCT ${errorEvents.platform}), NULL)`,
        versions: sql<string[]>`array_remove(array_agg(DISTINCT ${errorEvents.appVersion}), NULL)`,
        count: sql<number>`count(*)::int`,
        lastSeen: sql<string>`max(${errorEvents.createdAt})`,
      })
      .from(errorEvents)
      .where(gte(errorEvents.createdAt, since))
      .groupBy(errorEvents.fingerprint, errorEvents.source)
      .orderBy(desc(sql`max(${errorEvents.createdAt})`))
      .limit(200);
    return rows.map((r) => ({ ...r, lastSeen: new Date(r.lastSeen).toISOString() }));
  }

  /** Daily counts per event for the last `days` days (and totals for a simple funnel). */
  async analytics(days = 30) {
    const from = new Date(this.clock.now().getTime() - (days - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = await this.dbs.db
      .select({
        day: analyticsDaily.day,
        event: analyticsDaily.event,
        platform: analyticsDaily.platform,
        count: sql<number>`sum(${analyticsDaily.count})::int`,
      })
      .from(analyticsDaily)
      .where(and(gte(analyticsDaily.day, from)))
      .groupBy(analyticsDaily.day, analyticsDaily.event, analyticsDaily.platform)
      .orderBy(analyticsDaily.day);
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.event] = (totals[r.event] ?? 0) + r.count;
    return { from, days, rows, totals };
  }
}
