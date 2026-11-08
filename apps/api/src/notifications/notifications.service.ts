import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbService, type Tx } from '../db/db.service.js';
import { devices, notifications, notificationTemplates, users } from '../db/schema.js';
import {
  PUSH_PROVIDER,
  SMS_PROVIDER,
  type PushProvider,
  type SmsProvider,
} from '../providers/messaging.provider.js';
import { DEFAULT_TEMPLATES, render, type Channel } from './templates.js';

/**
 * Notifications are written in the same DB transaction as the change that caused them
 * (outbox pattern), deduplicated by `dedupeKey`, and dispatched after commit.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly dbs: DbService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async seedTemplates(tx: Tx = this.dbs.db): Promise<void> {
    const rows = Object.entries(DEFAULT_TEMPLATES).flatMap(([key, t]) =>
      (['ar', 'en'] as const).map((language) => ({
        key,
        language,
        title: t[language].title,
        body: t[language].body,
        channels: t.channels,
      })),
    );
    await tx.insert(notificationTemplates).values(rows).onConflictDoNothing();
  }

  async notify(
    tx: Tx,
    userId: string,
    eventKey: string,
    params: Record<string, string | number>,
    dedupeKey: string,
  ): Promise<void> {
    const [user] = await tx
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, userId));
    const language = user?.language === 'en' ? 'en' : 'ar';
    const [tpl] = await tx
      .select()
      .from(notificationTemplates)
      .where(
        and(eq(notificationTemplates.key, eventKey), eq(notificationTemplates.language, language)),
      );
    const fallback = DEFAULT_TEMPLATES[eventKey];
    if (!tpl && !fallback) throw new Error(`no template ${eventKey}`);
    const title = render(tpl?.title ?? fallback![language].title, params);
    const body = render(tpl?.body ?? fallback![language].body, params);
    const channels = (tpl?.channels ?? fallback!.channels) as Channel[];
    await tx
      .insert(notifications)
      .values({ userId, eventKey, title, body, channels, data: params, dedupeKey })
      .onConflictDoNothing({ target: notifications.dedupeKey });
  }

  /** Send everything pending. Safe to call repeatedly. */
  async dispatchPending(limit = 200): Promise<number> {
    const pending = await this.dbs.db
      .select()
      .from(notifications)
      .where(eq(notifications.status, 'PENDING'))
      .orderBy(asc(notifications.createdAt))
      .limit(limit);
    if (pending.length === 0) return 0;
    const userIds = [...new Set(pending.map((n) => n.userId))];
    const userRows = await this.dbs.db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(inArray(users.id, userIds));
    const deviceRows = await this.dbs.db
      .select()
      .from(devices)
      .where(inArray(devices.userId, userIds));
    for (const n of pending) {
      try {
        const tokens = deviceRows.filter((d) => d.userId === n.userId).map((d) => d.pushToken);
        if (n.channels.includes('push') && tokens.length > 0)
          await this.push.send(tokens, n.title, n.body);
        const phone = userRows.find((u) => u.id === n.userId)?.phone;
        if (n.channels.includes('sms') && phone)
          await this.sms.send(phone, `${n.title}: ${n.body}`);
        await this.dbs.db
          .update(notifications)
          .set({ status: 'SENT', sentAt: new Date() })
          .where(eq(notifications.id, n.id));
      } catch (e) {
        this.logger.warn(`notification ${n.id} failed: ${(e as Error).message}`);
        await this.dbs.db
          .update(notifications)
          .set({ status: 'FAILED' })
          .where(eq(notifications.id, n.id));
      }
    }
    return pending.length;
  }
}
