import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AddendumView, ContractResponse, SignatureView } from '@sanad/api-client';
import { holdbackAmount, payoutAmount } from '@sanad/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { ClockService } from '../common/clock.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { notFound, unprocessable } from '../common/errors.js';
import { money } from '../common/money.js';
import { DbService, type Tx } from '../db/db.service.js';
import {
  circleMembers,
  circles,
  contractSignatures,
  contracts,
  installments,
  kycVerifications,
  users,
} from '../db/schema.js';
import { addendumDoc, contractDoc } from '../pdf/documents.js';
import { sha256 } from '../pdf/pdfkit.generator.js';
import {
  PDF_GENERATOR,
  STORAGE_PROVIDER,
  type PdfGenerator,
  type StorageProvider,
} from '../providers/storage.provider.js';
import { LegalDocsService } from './legal-docs.service.js';

/**
 * [LEGAL] Placeholder membership contract. The founder uploads the lawyer's final text later:
 * publish it as a new version in the admin dashboard (Content → Contracts) and attach the
 * lawyer's file (Content → Legal documents). Until then every screen and PDF says "placeholder".
 */
const PLACEHOLDER = {
  titleAr: 'عقد عضوية سند (مسودة — للمراجعة القانونية)',
  titleEn: 'Sanad membership agreement (draft — pending legal review)',
  bodyAr:
    'هذه مسودة غير نهائية. سند تنظّم الجمعية ولا تضمنها. يلتزم العضو بسداد القسط الشهري كاملًا في موعده طوال مدة الجمعية، بما في ذلك الشهر الذي يستلم فيه والأشهر التالية. يُدفع رسم التنظيم مرة واحدة عند الانضمام ويُعاد كاملًا إذا لم تبدأ الجمعية. يستلم صاحب كل دور ما جُمع فعلًا لذلك الشهر بعد خصم مبلغ المزايدة والمبلغ المحتجز، وما يصل متأخرًا يُحوَّل إليه لاحقًا. إذا تعثّر عضو بعد استلامه، يُستخدم المبلغ المحتجز ثم ما يُحصَّل منه قانونيًا لتعويض الأعضاء المتضررين، وتتحمّل سند رسم تحصيل من المبالغ المحصّلة، وقد لا يُعوَّض النقص كاملًا. [يُستبدل بالنص القانوني المعتمد]',
  bodyEn:
    'This is a non-final draft. Sanad organises the circle and does not guarantee it. The member agrees to pay the full monthly contribution on time for the whole circle, including the month they receive the pot and the months after. The organising fee is paid once on joining and refunded in full if the circle never starts. Each month\'s recipient receives what was actually collected for that month, minus their priority bid and holdback; money that arrives late is forwarded to them. If a member defaults after receiving, their holdback and then anything recovered from them legally go to the affected members, minus a recovery fee for Sanad; a shortfall may not be fully recovered. [To be replaced by the approved legal text]',
};

export interface SignMeta {
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
}

const maskPhone = (p: string) => `${p.slice(0, 4)}••••${p.slice(-4)}`;
const maskCivil = (c: string) => `${c.slice(0, 3)}••••••${c.slice(-3)}`;
const canonical = (v: unknown) => JSON.stringify(v);

/**
 * Membership contract (spec §8): versions, OTP e-signature with a generated PDF, and the
 * post-draw addendum (spot, payout date, schedule) that each member acknowledges.
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly dbs: DbService,
    private readonly auth: AuthService,
    private readonly crypto: CryptoService,
    private readonly clock: ClockService,
    private readonly legal: LegalDocsService,
    @Inject(PDF_GENERATOR) private readonly pdf: PdfGenerator,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  static hashOf(c: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }): string {
    return createHash('sha256')
      .update(JSON.stringify([c.titleAr, c.titleEn, c.bodyAr, c.bodyEn]))
      .digest('hex');
  }

  async ensureSeeded(tx: Tx = this.dbs.db): Promise<void> {
    await tx
      .insert(contracts)
      .values({ version: 1, ...PLACEHOLDER, sha256: ContractsService.hashOf(PLACEHOLDER) })
      .onConflictDoNothing();
  }

  async current(tx: Tx = this.dbs.db): Promise<typeof contracts.$inferSelect> {
    const [c] = await tx
      .select()
      .from(contracts)
      .where(eq(contracts.kind, 'MEMBERSHIP'))
      .orderBy(desc(contracts.version))
      .limit(1);
    if (!c) {
      await this.ensureSeeded(tx);
      return this.current(tx);
    }
    return c;
  }

  async view(userId: string): Promise<ContractResponse> {
    const c = await this.current();
    return {
      version: c.version,
      titleAr: c.titleAr,
      titleEn: c.titleEn,
      bodyAr: c.bodyAr,
      bodyEn: c.bodyEn,
      sha256: c.sha256,
      signed: await this.hasSignedCurrent(userId),
      legal: await this.legal.status(c.version),
    };
  }

  private async member(userId: string) {
    const [u] = await this.dbs.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound('member');
    return u;
  }

  /** Step 1 of signing: SMS a one-time code to the member's own phone. */
  async requestSignCode(userId: string, version: number, language: 'ar' | 'en') {
    const c = await this.current();
    if (c.version !== version)
      throw unprocessable('OUTDATED_CONTRACT', `please review and sign version ${c.version}`);
    const u = await this.member(userId);
    return this.auth.issueCode(u.phone, 'CONTRACT_SIGN', 'contract.sign_otp', language);
  }

  /** Step 2: the code proves the member signed this exact version; a PDF is generated and kept. */
  async sign(userId: string, version: number, code: string, meta: SignMeta) {
    const c = await this.current();
    if (c.version !== version)
      throw unprocessable('OUTDATED_CONTRACT', `please review and sign version ${c.version}`);
    const u = await this.member(userId);
    const otpRef = await this.auth.consumeCode(u.phone, 'CONTRACT_SIGN', code);
    return this.recordSignature(userId, version, { ...meta, otpReference: otpRef });
  }

  /** Store the signature + signed PDF (also used by the seed script with a fixed reference). */
  async recordSignature(
    userId: string,
    version: number,
    meta: SignMeta & { otpReference: string },
  ): Promise<{ version: number; documentHash: string; signatureId: string }> {
    const c = await this.current();
    const existing = await this.latestSignatureFor(userId, version);
    if (existing) return { version, documentHash: c.sha256, signatureId: existing.id };
    const [sig] = await this.dbs.db
      .insert(contractSignatures)
      .values({
        userId,
        kind: 'MEMBERSHIP',
        contractVersion: version,
        documentHash: c.sha256,
        ip: meta.ip,
        userAgent: meta.userAgent,
        deviceId: meta.deviceId,
        otpReference: meta.otpReference,
        signedAt: this.clock.now(),
      })
      .returning();
    await this.storeContractPdf(sig!.id);
    return { version, documentHash: c.sha256, signatureId: sig!.id };
  }

  private async latestSignatureFor(userId: string, version: number) {
    const [s] = await this.dbs.db
      .select()
      .from(contractSignatures)
      .where(
        and(
          eq(contractSignatures.userId, userId),
          eq(contractSignatures.kind, 'MEMBERSHIP'),
          eq(contractSignatures.contractVersion, version),
        ),
      )
      .limit(1);
    return s ?? null;
  }

  private async signerOf(userId: string) {
    const u = await this.member(userId);
    const [kyc] = await this.dbs.db
      .select()
      .from(kycVerifications)
      .where(and(eq(kycVerifications.userId, userId), eq(kycVerifications.status, 'APPROVED')))
      .orderBy(desc(kycVerifications.createdAt))
      .limit(1);
    return {
      name: u.fullNameAr ?? u.fullNameEn ?? maskPhone(u.phone),
      nameEn: u.fullNameEn,
      civilIdMasked: kyc ? maskCivil(this.crypto.decrypt(kyc.civilIdEncrypted)) : null,
      phoneMasked: maskPhone(u.phone),
    };
  }

  private async storeContractPdf(signatureId: string): Promise<Buffer> {
    const [sig] = await this.dbs.db
      .select()
      .from(contractSignatures)
      .where(eq(contractSignatures.id, signatureId));
    if (!sig?.contractVersion) throw notFound('signature');
    const [c] = await this.dbs.db
      .select()
      .from(contracts)
      .where(eq(contracts.version, sig.contractVersion));
    if (!c) throw notFound('contract version');
    const legal = LegalDocsService.forDoc(await this.legal.status(c.version));
    const buf = await this.pdf.render(
      contractDoc({
        version: c.version,
        titleAr: c.titleAr,
        titleEn: c.titleEn,
        bodyAr: c.bodyAr,
        bodyEn: c.bodyEn,
        textHash: c.sha256,
        signer: await this.signerOf(sig.userId),
        signedAt: sig.signedAt,
        ip: sig.ip,
        device: sig.userAgent ? sig.userAgent.slice(0, 80) : sig.deviceId,
        otpReference: sig.otpReference,
        legal,
      }),
    );
    const key = await this.storage.put('signed-docs', buf, 'application/pdf');
    await this.dbs.db
      .update(contractSignatures)
      .set({ pdfKey: key, pdfSha256: sha256(buf) })
      .where(eq(contractSignatures.id, signatureId));
    return buf;
  }

  async hasSignedCurrent(userId: string, tx: Tx = this.dbs.db): Promise<boolean> {
    const c = await this.current(tx);
    const [s] = await tx
      .select({ id: contractSignatures.id })
      .from(contractSignatures)
      .where(
        and(
          eq(contractSignatures.userId, userId),
          eq(contractSignatures.kind, 'MEMBERSHIP'),
          eq(contractSignatures.contractVersion, c.version),
        ),
      );
    return Boolean(s);
  }

  async signatures(userId: string): Promise<SignatureView[]> {
    const rows = await this.dbs.db
      .select()
      .from(contractSignatures)
      .where(eq(contractSignatures.userId, userId))
      .orderBy(desc(contractSignatures.signedAt));
    return rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      contractVersion: s.contractVersion,
      circleId: s.circleId,
      documentHash: s.documentHash,
      signedAt: s.signedAt.toISOString(),
      hasPdf: Boolean(s.pdfKey),
    }));
  }

  /** The stored PDF of a signature (member: only their own; staff: any, audited by caller). */
  async signaturePdf(
    signatureId: string,
    userId?: string,
  ): Promise<{ data: Buffer; filename: string }> {
    const [s] = await this.dbs.db
      .select()
      .from(contractSignatures)
      .where(eq(contractSignatures.id, signatureId));
    if (!s || (userId && s.userId !== userId)) throw notFound('document');
    let data: Buffer;
    if (s.pdfKey) data = (await this.storage.get(s.pdfKey)).data;
    else if (s.kind === 'MEMBERSHIP')
      data = await this.storeContractPdf(s.id); // signed before Phase 5
    else if (s.circleId) data = (await this.renderAddendum(s.userId, s.circleId)).pdf;
    else throw notFound('document');
    const name =
      s.kind === 'MEMBERSHIP'
        ? `sanad-contract-v${s.contractVersion}.pdf`
        : `sanad-addendum-${(s.circleId ?? '').slice(0, 8)}.pdf`;
    return { data, filename: name };
  }

  async latestSignature(userId: string, kind: 'MEMBERSHIP' | 'ADDENDUM', circleId?: string) {
    const [s] = await this.dbs.db
      .select()
      .from(contractSignatures)
      .where(
        and(
          eq(contractSignatures.userId, userId),
          eq(contractSignatures.kind, kind),
          ...(circleId ? [eq(contractSignatures.circleId, circleId)] : []),
        ),
      )
      .orderBy(desc(contractSignatures.signedAt))
      .limit(1);
    return s ?? null;
  }

  // ── addendum (spec §8: after DRAWING, spot + payout date + schedule, acknowledged) ──

  async addendum(userId: string, circleId: string): Promise<AddendumView> {
    const [circle] = await this.dbs.db.select().from(circles).where(eq(circles.id, circleId));
    if (!circle) throw notFound('circle');
    if (!['ACTIVE', 'CLOSING', 'CLOSED'].includes(circle.status))
      throw unprocessable('NOT_DRAWN', 'the addendum is available after the draw');
    const [m] = await this.dbs.db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
    const spot = m?.spot ?? m?.originalSpot;
    if (!m || !spot) throw notFound('membership');
    const rows = await this.dbs.db
      .select()
      .from(installments)
      .where(and(eq(installments.circleId, circleId), eq(installments.spot, spot)))
      .orderBy(asc(installments.month));
    const pot = circle.monthlyFils * BigInt(circle.members);
    const holdback = holdbackAmount(pot, BigInt(m.holdbackBps));
    const expected = payoutAmount(pot, m.bidFils, holdback);
    const payoutDate = rows.find((r) => r.month === spot)?.payoutDate ?? '';
    const schedule = rows.map((r) => ({
      month: r.month,
      dueDate: r.dueDate,
      payoutDate: r.payoutDate,
      amount: money(r.amountFils),
      recipientSpot: r.month,
    }));
    const documentHash = createHash('sha256')
      .update(
        canonical({
          circleId,
          userId,
          spot,
          monthly: circle.monthlyFils.toString(),
          pot: pot.toString(),
          bid: m.bidFils.toString(),
          holdback: holdback.toString(),
          expected: expected.toString(),
          payoutDate,
          schedule: schedule.map((s) => [s.month, s.dueDate, s.payoutDate, s.amount.fils]),
        }),
      )
      .digest('hex');
    const ack = await this.latestSignature(userId, 'ADDENDUM', circleId);
    return {
      circleId,
      spot,
      months: circle.members,
      monthly: money(circle.monthlyFils),
      pot: money(pot),
      bid: money(m.bidFils),
      holdback: money(holdback),
      holdbackPct: m.holdbackBps / 100,
      expectedPayout: money(expected),
      payoutDate,
      schedule,
      documentHash,
      acknowledged: Boolean(ack && ack.documentHash === documentHash),
      acknowledgedAt: ack ? ack.signedAt.toISOString() : null,
      signatureId: ack?.id ?? null,
    };
  }

  private async renderAddendum(userId: string, circleId: string) {
    const a = await this.addendum(userId, circleId);
    const ack = await this.latestSignature(userId, 'ADDENDUM', circleId);
    const [c] = await this.dbs.db
      .select({ commitment: circles.commitment })
      .from(circles)
      .where(eq(circles.id, circleId));
    const u = await this.member(userId);
    const pdf = await this.pdf.render(
      addendumDoc({
        ...a,
        memberName: u.fullNameAr ?? u.fullNameEn ?? maskPhone(u.phone),
        drawCommitment: c?.commitment ?? null,
        acknowledgedAt: ack?.signedAt ?? null,
        ip: ack?.ip ?? null,
      }),
    );
    return { a, pdf };
  }

  async addendumPdf(userId: string, circleId: string) {
    return (await this.renderAddendum(userId, circleId)).pdf;
  }

  async acknowledgeAddendum(
    userId: string,
    circleId: string,
    documentHash: string,
    meta: SignMeta,
  ) {
    const a = await this.addendum(userId, circleId);
    if (a.documentHash !== documentHash)
      throw unprocessable('ADDENDUM_CHANGED', 'the schedule changed; please review it again');
    if (!a.acknowledged) {
      const [row] = await this.dbs.db
        .insert(contractSignatures)
        .values({
          userId,
          kind: 'ADDENDUM',
          circleId,
          documentHash,
          ip: meta.ip,
          userAgent: meta.userAgent,
          deviceId: meta.deviceId,
          signedAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
      if (row) {
        const { pdf } = await this.renderAddendum(userId, circleId);
        const key = await this.storage.put('signed-docs', pdf, 'application/pdf');
        await this.dbs.db
          .update(contractSignatures)
          .set({ pdfKey: key, pdfSha256: sha256(pdf) })
          .where(eq(contractSignatures.id, row.id));
      }
    }
    return this.addendum(userId, circleId);
  }

  /** Circles where the member still has to acknowledge the addendum (shown on Home). */
  async pendingAddenda(userId: string): Promise<string[]> {
    const rows = await this.dbs.db
      .select({ id: circles.id })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circleMembers.userId, userId), inArray(circles.status, ['ACTIVE'])));
    const out: string[] = [];
    for (const r of rows) {
      const a = await this.addendum(userId, r.id).catch(() => null);
      if (a && !a.acknowledged) out.push(r.id);
    }
    return out;
  }
}
