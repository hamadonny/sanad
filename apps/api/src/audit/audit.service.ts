import { Injectable } from '@nestjs/common';
import type { Tx } from '../db/db.service.js';
import { auditLogs } from '../db/schema.js';
import { bigintReplacer } from '../common/money.js';

export interface AuditEntry {
  actorType: 'admin' | 'member' | 'system';
  actorId: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  details?: unknown;
  ip?: string | null;
}

/** Immutable audit log (spec §3, §15). Rows can never be updated or deleted (DB trigger). */
@Injectable()
export class AuditService {
  async log(tx: Tx, e: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      actorType: e.actorType,
      actorId: e.actorId,
      action: e.action,
      entity: e.entity ?? null,
      entityId: e.entityId ?? null,
      details:
        e.details === undefined
          ? null
          : (JSON.parse(JSON.stringify(e.details, bigintReplacer)) as unknown),
      ip: e.ip ?? null,
    });
  }
}
