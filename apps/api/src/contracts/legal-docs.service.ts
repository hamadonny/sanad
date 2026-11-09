import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LegalDocument, LegalStatus } from '@sanad/api-client';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AdminPrincipal } from '../auth/guards.js';
import { notFound, unprocessable } from '../common/errors.js';
import { matchesDeclared } from '../common/file-type.js';
import { DbService, type Tx } from '../db/db.service.js';
import { contracts, legalDocuments } from '../db/schema.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../providers/storage.provider.js';
import type { LegalStatusForDoc } from '../pdf/documents.js';

export const LEGAL_DOC_KINDS = ['CONTRACT_SOURCE', 'SHARIAH_REVIEW'] as const;
export const SHARIAH_STATUSES = [
  'PENDING',
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
] as const;
export const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};
export const MAX_LEGAL_DOC_BYTES = 15 * 1024 * 1024;

export interface UploadInput {
  kind: (typeof LEGAL_DOC_KINDS)[number];
  title: string;
  contractVersion?: number | undefined;
  reviewer?: string | undefined;
  reviewedOn?: string | undefined;
  status?: (typeof SHARIAH_STATUSES)[number] | undefined;
  notes?: string | undefined;
}

/**
 * Founder-uploaded legal documents [LEGAL][SHARIAH]: the lawyer's final contract for a contract
 * version, and the Shariah review. Until they exist the app and every PDF say so plainly.
 */
@Injectable()
export class LegalDocsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private view(d: typeof legalDocuments.$inferSelect): LegalDocument {
    return {
      id: d.id,
      kind: d.kind,
      contractVersion: d.contractVersion,
      title: d.title,
      reviewer: d.reviewer,
      reviewedOn: d.reviewedOn,
      status: d.status,
      notes: d.notes,
      filename: d.filename,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
      sha256: d.sha256,
      createdAt: d.createdAt.toISOString(),
    };
  }

  async list(): Promise<LegalDocument[]> {
    const rows = await this.dbs.db
      .select()
      .from(legalDocuments)
      .orderBy(desc(legalDocuments.createdAt));
    return rows.map((r) => this.view(r));
  }

  async upload(
    admin: AdminPrincipal,
    input: UploadInput,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined,
  ): Promise<LegalDocument> {
    if (!file) throw unprocessable('FILE_REQUIRED', 'attach the document file');
    if (!ALLOWED_TYPES[file.mimetype] || !matchesDeclared(file.buffer, file.mimetype))
      throw unprocessable('FILE_TYPE', 'upload a PDF, Word (.docx), PNG or JPEG file');
    if (file.size > MAX_LEGAL_DOC_BYTES) throw unprocessable('FILE_TOO_LARGE', 'maximum 15 MB');
    if (input.kind === 'CONTRACT_SOURCE') {
      if (!input.contractVersion)
        throw unprocessable('VERSION_REQUIRED', 'choose the contract version this file is for');
      const [c] = await this.dbs.db
        .select({ v: contracts.version })
        .from(contracts)
        .where(eq(contracts.version, input.contractVersion));
      if (!c) throw notFound('contract version');
    }
    const status = input.kind === 'SHARIAH_REVIEW' ? (input.status ?? 'PENDING') : 'UPLOADED';
    const key = await this.storage.put('legal-docs', file.buffer, file.mimetype);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const [row] = await this.dbs.transaction(async (tx) => {
      const inserted = await tx
        .insert(legalDocuments)
        .values({
          kind: input.kind,
          contractVersion:
            input.kind === 'CONTRACT_SOURCE' ? (input.contractVersion ?? null) : null,
          title: input.title,
          reviewer: input.reviewer ?? null,
          reviewedOn: input.reviewedOn ?? null,
          status,
          notes: input.notes ?? null,
          storageKey: key,
          filename: file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120),
          contentType: file.mimetype,
          sizeBytes: file.size,
          sha256,
          uploadedBy: admin.id,
        })
        .returning();
      await this.audit.log(tx, {
        actorType: 'admin',
        actorId: admin.id,
        action:
          input.kind === 'SHARIAH_REVIEW'
            ? 'legal_doc.shariah_upload'
            : 'legal_doc.contract_upload',
        entity: 'legal_document',
        entityId: inserted[0]!.id,
        details: { title: input.title, status, sha256, contractVersion: input.contractVersion },
      });
      return inserted;
    });
    return this.view(row!);
  }

  async file(id: string, publicOnly = false) {
    const [d] = await this.dbs.db.select().from(legalDocuments).where(eq(legalDocuments.id, id));
    if (!d) throw notFound('document');
    // Members may download an approved Shariah review; everything else is staff-only.
    if (publicOnly && !(d.kind === 'SHARIAH_REVIEW' && d.status.startsWith('APPROVED')))
      throw notFound('document');
    const f = await this.storage.get(d.storageKey);
    return { ...f, filename: d.filename };
  }

  /** What members and PDFs are told about the legal review of the current contract. */
  async status(currentVersion: number, tx: Tx = this.dbs.db): Promise<LegalStatus> {
    const [source] = await tx
      .select()
      .from(legalDocuments)
      .where(
        and(
          eq(legalDocuments.kind, 'CONTRACT_SOURCE'),
          eq(legalDocuments.contractVersion, currentVersion),
        ),
      )
      .orderBy(desc(legalDocuments.createdAt))
      .limit(1);
    const [shariah] = await tx
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.kind, 'SHARIAH_REVIEW'))
      .orderBy(desc(legalDocuments.createdAt))
      .limit(1);
    return {
      contractVersion: currentVersion,
      lawyerApproved: Boolean(source),
      contractDocument: source
        ? { id: source.id, title: source.title, uploadedAt: source.createdAt.toISOString() }
        : null,
      shariah: shariah
        ? {
            id: shariah.id,
            status: shariah.status,
            reviewer: shariah.reviewer,
            reviewedOn: shariah.reviewedOn,
            title: shariah.title,
            downloadable: shariah.status.startsWith('APPROVED'),
          }
        : null,
    };
  }

  static forDoc(s: LegalStatus): LegalStatusForDoc {
    return {
      lawyerApproved: s.lawyerApproved,
      shariah: s.shariah
        ? {
            status: s.shariah.status,
            reviewer: s.shariah.reviewer,
            reviewedOn: s.shariah.reviewedOn,
          }
        : null,
    };
  }
}
