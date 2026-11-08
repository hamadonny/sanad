import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { notFound, unprocessable } from '../common/errors.js';
import { DbService, type Tx } from '../db/db.service.js';
import { contractSignatures, contracts } from '../db/schema.js';

/**
 * [LEGAL] Placeholder membership contract. The real text comes from the founder's lawyer and is
 * published as a new version (never hard-coded in the app). Phase 5 adds PDF + OTP e-signature.
 */
const PLACEHOLDER = {
  titleAr: 'عقد عضوية سند (مسودة — للمراجعة القانونية)',
  titleEn: 'Sanad membership agreement (draft — pending legal review)',
  bodyAr:
    'هذه مسودة غير نهائية. يلتزم العضو بسداد القسط الشهري كاملًا في موعده طوال مدة الجمعية، بما في ذلك الشهر الذي يستلم فيه والأشهر التالية. رسم العضوية يُدفع مرة واحدة عند الانضمام. [يُستبدل بالنص القانوني المعتمد]',
  bodyEn:
    'This is a non-final draft. The member agrees to pay the full monthly contribution on time for the whole circle, including the month they receive the pot and the months after. The membership fee is paid once on joining. [To be replaced by the approved legal text]',
};

@Injectable()
export class ContractsService {
  constructor(private readonly dbs: DbService) {}

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

  async sign(
    userId: string,
    version: number,
    meta: { ip: string | null; userAgent: string | null; deviceId: string | null },
  ) {
    const c = await this.current();
    if (c.version !== version)
      throw unprocessable('OUTDATED_CONTRACT', `please review and sign version ${c.version}`);
    await this.dbs.db
      .insert(contractSignatures)
      .values({
        userId,
        kind: 'MEMBERSHIP',
        contractVersion: version,
        documentHash: c.sha256,
        ip: meta.ip,
        userAgent: meta.userAgent,
        deviceId: meta.deviceId,
      })
      .onConflictDoNothing();
    return { version, documentHash: c.sha256 };
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

  async signature(userId: string) {
    const [s] = await this.dbs.db
      .select()
      .from(contractSignatures)
      .where(eq(contractSignatures.userId, userId))
      .orderBy(desc(contractSignatures.signedAt))
      .limit(1);
    if (!s) throw notFound('signature');
    return s;
  }
}
