import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { AuditService } from '../audit/audit.service.js';
import type { AdminPrincipal } from '../auth/guards.js';
import { bigintReplacer } from '../common/money.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { DbService } from '../db/db.service.js';
import { contractSignatures, kycVerifications } from '../db/schema.js';
import { caseFileDoc } from '../pdf/documents.js';
import {
  PDF_GENERATOR,
  STORAGE_PROVIDER,
  type PdfGenerator,
  type StorageProvider,
} from '../providers/storage.provider.js';
import { AdminViewsService } from './admin-views.service.js';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

/**
 * Legal case file downloads (spec §8): a PDF, and a ZIP with the PDF, the raw data (JSON), the
 * signed contract, the addendum and the identity documents. Every download is audited.
 */
@Injectable()
export class CaseFilesService {
  constructor(
    private readonly dbs: DbService,
    private readonly views: AdminViewsService,
    private readonly contracts: ContractsService,
    private readonly audit: AuditService,
    @Inject(PDF_GENERATOR) private readonly pdf: PdfGenerator,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async pdfFile(admin: AdminPrincipal, caseId: string, ip: string | null): Promise<Buffer> {
    const file = await this.views.legalCaseFile(admin, caseId, ip);
    return this.pdf.render(caseFileDoc(file));
  }

  async zipFile(admin: AdminPrincipal, caseId: string, ip: string | null): Promise<Buffer> {
    const file = await this.views.legalCaseFile(admin, caseId, ip);
    const files: Zippable = {
      'case-file.pdf': await this.pdf.render(caseFileDoc(file)),
      'case-file.json': strToU8(JSON.stringify(file, bigintReplacer, 2)),
    };
    const userId = file.member.id;
    const sigs = await this.dbs.db
      .select()
      .from(contractSignatures)
      .where(eq(contractSignatures.userId, userId))
      .orderBy(desc(contractSignatures.signedAt));
    for (const s of sigs) {
      if (s.kind === 'MEMBERSHIP' || s.circleId === file.circle.id) {
        const { data, filename } = await this.contracts.signaturePdf(s.id);
        files[`signed/${filename}`] = data;
      }
    }
    const [kyc] = await this.dbs.db
      .select()
      .from(kycVerifications)
      .where(and(eq(kycVerifications.userId, userId), eq(kycVerifications.status, 'APPROVED')))
      .orderBy(desc(kycVerifications.createdAt))
      .limit(1);
    if (kyc) {
      for (const [name, key] of [
        ['civil-id-front', kyc.frontDocKey],
        ['civil-id-back', kyc.backDocKey],
        ['selfie', kyc.selfieKey],
      ] as const) {
        if (!key) continue;
        const doc = await this.storage.get(key);
        files[`identity/${name}.${EXT[doc.contentType] ?? 'bin'}`] = doc.data;
      }
    }
    await this.audit.log(this.dbs.db, {
      actorType: 'admin',
      actorId: admin.id,
      action: 'legal.case_zip',
      entity: 'legal_case',
      entityId: caseId,
      details: { files: Object.keys(files) },
      ip,
    });
    // Fixed timestamps keep the archive reproducible for the same content.
    return Buffer.from(zipSync(files, { level: 6, mtime: new Date(file.generatedAt) }));
  }
}
