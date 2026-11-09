import { Injectable } from '@nestjs/common';
import type { AdminContract, AdminTemplate, FaqItem } from '@sanad/api-client';
import { resources } from '@sanad/i18n';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AdminPrincipal } from '../auth/guards.js';
import { ClockService } from '../common/clock.service.js';
import { notFound, unprocessable } from '../common/errors.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { DbService } from '../db/db.service.js';
import { contracts, faqItems, notificationTemplates, supportTickets } from '../db/schema.js';
import { DEFAULT_TEMPLATES } from '../notifications/templates.js';

/** `{{name}}` placeholders used in a template text. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();
}

/** Templates the admin may not edit: the OTP SMS stays fixed (security; spec §15). */
export const LOCKED_TEMPLATES = new Set(['auth.otp', 'contract.sign_otp']);

const faqView = (r: typeof faqItems.$inferSelect): FaqItem => ({
  id: r.id,
  position: r.position,
  questionAr: r.questionAr,
  answerAr: r.answerAr,
  questionEn: r.questionEn,
  answerEn: r.answerEn,
  published: r.published,
});

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const;

export interface FaqInput {
  questionAr: string;
  answerAr: string;
  questionEn: string;
  answerEn: string;
  position?: number;
  published?: boolean;
}

/**
 * Admin-editable content (spec §10 Content): notification templates, contract versions, FAQ,
 * plus support ticket handling. Every change is audited.
 */
@Injectable()
export class ContentService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly contractsSvc: ContractsService,
  ) {}

  // ── notification templates ──

  async templates(): Promise<AdminTemplate[]> {
    const rows = await this.dbs.db.select().from(notificationTemplates);
    return Object.entries(DEFAULT_TEMPLATES)
      .filter(([key]) => !LOCKED_TEMPLATES.has(key))
      .map(([key, def]) => {
        const ar = rows.find((r) => r.key === key && r.language === 'ar');
        const en = rows.find((r) => r.key === key && r.language === 'en');
        const cur = {
          ar: { title: ar?.title ?? def.ar.title, body: ar?.body ?? def.ar.body },
          en: { title: en?.title ?? def.en.title, body: en?.body ?? def.en.body },
        };
        return {
          key,
          channels: def.channels,
          placeholders: placeholders(
            `${def.ar.title} ${def.ar.body} ${def.en.title} ${def.en.body}`,
          ),
          ...cur,
          customized: JSON.stringify(cur) !== JSON.stringify({ ar: def.ar, en: def.en }),
        };
      });
  }

  async updateTemplate(
    admin: AdminPrincipal,
    key: string,
    language: 'ar' | 'en',
    title: string,
    body: string,
  ): Promise<AdminTemplate> {
    const def = DEFAULT_TEMPLATES[key];
    if (!def || LOCKED_TEMPLATES.has(key)) throw notFound('template');
    const allowed = new Set(placeholders(`${def[language].title} ${def[language].body}`));
    const unknown = placeholders(`${title} ${body}`).filter((p) => !allowed.has(p));
    if (unknown.length > 0)
      throw unprocessable(
        'UNKNOWN_PLACEHOLDER',
        `unknown placeholder(s): ${unknown.map((p) => `{{${p}}}`).join(', ')}`,
      );
    await this.dbs.transaction(async (tx) => {
      await tx
        .insert(notificationTemplates)
        .values({ key, language, title, body, channels: def.channels })
        .onConflictDoUpdate({
          target: [notificationTemplates.key, notificationTemplates.language],
          set: { title, body, updatedAt: this.clock.now() },
        });
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'content.template',
        entity: 'template',
        entityId: `${key}:${language}`,
        details: { title, body },
      });
    });
    return (await this.templates()).find((t) => t.key === key)!;
  }

  // ── contracts [LEGAL] ──

  async contracts(): Promise<AdminContract[]> {
    await this.contractsSvc.ensureSeeded();
    const rows = await this.dbs.db
      .select({
        c: contracts,
        signatures: sql<number>`(SELECT count(*)::int FROM contract_signatures s WHERE s.contract_version = ${contracts.version} AND s.kind = 'MEMBERSHIP')`,
      })
      .from(contracts)
      .orderBy(desc(contracts.version));
    return rows.map(({ c, signatures }) => ({
      ...c,
      publishedAt: c.publishedAt.toISOString(),
      signatures,
    }));
  }

  /**
   * Publishing a new version means every member must review and sign it before their next
   * join (the app already checks `hasSignedCurrent`). The text itself is the lawyer's [LEGAL].
   */
  async publishContract(
    admin: AdminPrincipal,
    input: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string },
  ): Promise<AdminContract> {
    const version = await this.dbs.transaction(async (tx) => {
      const [last] = await tx
        .select({ v: contracts.version })
        .from(contracts)
        .orderBy(desc(contracts.version))
        .limit(1);
      const next = (last?.v ?? 0) + 1;
      await tx
        .insert(contracts)
        .values({ version: next, ...input, sha256: ContractsService.hashOf(input) });
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'content.contract_publish',
        entity: 'contract',
        entityId: String(next),
        details: { sha256: ContractsService.hashOf(input) },
      });
      return next;
    });
    return (await this.contracts()).find((c) => c.version === version)!;
  }

  // ── FAQ ──

  /** First run: copy the FAQ bundled in the app (i18n) into the table so it can be edited. */
  async ensureFaqSeeded(): Promise<void> {
    const [{ n } = { n: 0 }] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(faqItems);
    if (n > 0) return;
    const ar = resources.ar.translation.support.faqItems as Record<string, string>;
    const en = resources.en.translation.support.faqItems as Record<string, string>;
    const rows = [1, 2, 3, 4, 5]
      .filter((i) => ar[`q${i}`] && en[`q${i}`])
      .map((i) => ({
        position: i,
        questionAr: ar[`q${i}`]!,
        answerAr: ar[`a${i}`]!,
        questionEn: en[`q${i}`]!,
        answerEn: en[`a${i}`]!,
      }));
    if (rows.length) await this.dbs.db.insert(faqItems).values(rows);
  }

  async faq(publishedOnly = false): Promise<FaqItem[]> {
    await this.ensureFaqSeeded();
    const rows = await this.dbs.db
      .select()
      .from(faqItems)
      .where(publishedOnly ? eq(faqItems.published, true) : undefined)
      .orderBy(asc(faqItems.position), asc(faqItems.questionEn));
    return rows.map(faqView);
  }

  async saveFaq(admin: AdminPrincipal, id: string | null, input: FaqInput): Promise<FaqItem> {
    const values = {
      questionAr: input.questionAr,
      answerAr: input.answerAr,
      questionEn: input.questionEn,
      answerEn: input.answerEn,
      position: input.position ?? 0,
      published: input.published ?? true,
      updatedAt: this.clock.now(),
    };
    const saved = await this.dbs.transaction(async (tx) => {
      const [row] = id
        ? await tx.update(faqItems).set(values).where(eq(faqItems.id, id)).returning()
        : await tx.insert(faqItems).values(values).returning();
      if (!row) throw notFound('FAQ item');
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: id ? 'content.faq_update' : 'content.faq_create',
        entity: 'faq',
        entityId: row.id,
      });
      return row;
    });
    return faqView(saved);
  }

  async deleteFaq(admin: AdminPrincipal, id: string): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const r = await tx.delete(faqItems).where(eq(faqItems.id, id)).returning({ id: faqItems.id });
      if (r.length === 0) throw notFound('FAQ item');
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'content.faq_delete',
        entity: 'faq',
        entityId: id,
      });
    });
  }

  // ── support tickets ──

  async updateTicket(
    admin: AdminPrincipal,
    id: string,
    status: (typeof TICKET_STATUSES)[number],
    note: string | null,
  ): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      const r = await tx
        .update(supportTickets)
        .set({ status, adminNote: note, updatedAt: this.clock.now() })
        .where(eq(supportTickets.id, id))
        .returning({ id: supportTickets.id });
      if (r.length === 0) throw notFound('ticket');
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'support.update',
        entity: 'ticket',
        entityId: id,
        details: { status, note },
      });
    });
  }
}
