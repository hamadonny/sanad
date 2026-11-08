/**
 * PaymentProvider (spec §12). Phase 2–6 use the mock only; a licensed Kuwaiti gateway is added
 * in Phase 7 behind this same interface.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { Fils } from '@sanad/core';

export interface ChargeRequest {
  paymentId: string;
  amount: Fils;
  description: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  providerRef: string;
  /** Where the app sends the member to pay (hosted page / deep link). */
  checkoutUrl: string;
}

export interface TransferRequest {
  /** Our id for the transfer (payout or refund row id); also the idempotency key. */
  reference: string;
  userId: string;
  amount: Fils;
  description: string;
}

export interface TransferResult {
  providerRef: string;
}

export type WebhookEvent =
  | {
      type: 'charge.succeeded';
      eventId: string;
      providerRef: string;
      paymentId: string;
      amount: Fils;
      paidAt: string;
    }
  | {
      type: 'charge.failed';
      eventId: string;
      providerRef: string;
      paymentId: string;
      reason: string;
    };

export interface PaymentProvider {
  readonly name: string;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  refund(req: TransferRequest & { originalProviderRef?: string }): Promise<TransferResult>;
  payout(req: TransferRequest): Promise<TransferResult>;
  /** Verify the signature and parse the event. Throws on an invalid signature. */
  parseWebhook(rawBody: string, signature: string | undefined): WebhookEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * Mock gateway: never moves money. Webhooks are HMAC-SHA256 signed with PAYMENT_WEBHOOK_SECRET
 * exactly like a real gateway would, so signature verification is exercised end to end.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  /** Test hook: make the next N transfers fail. */
  failNextTransfers = 0;
  readonly transfers: (TransferRequest & { kind: 'refund' | 'payout'; providerRef: string })[] = [];

  constructor(private readonly secret: string) {}

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    const providerRef = `mockch_${req.paymentId}`;
    return { providerRef, checkoutUrl: `sanad-mock://checkout/${req.paymentId}` };
  }

  private async transfer(kind: 'refund' | 'payout', req: TransferRequest): Promise<TransferResult> {
    if (this.failNextTransfers > 0) {
      this.failNextTransfers -= 1;
      throw new Error('mock gateway: transfer declined');
    }
    const existing = this.transfers.find((t) => t.reference === req.reference && t.kind === kind);
    if (existing) return { providerRef: existing.providerRef };
    const providerRef = `mock${kind === 'refund' ? 'rf' : 'po'}_${randomUUID()}`;
    this.transfers.push({ ...req, kind, providerRef });
    return { providerRef };
  }

  refund(req: TransferRequest): Promise<TransferResult> {
    return this.transfer('refund', req);
  }

  payout(req: TransferRequest): Promise<TransferResult> {
    return this.transfer('payout', req);
  }

  sign(rawBody: string): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  /** Build a signed webhook body the way the gateway would (used by dev endpoint and tests). */
  buildWebhook(event: WebhookEvent): { body: string; signature: string } {
    const body = JSON.stringify(event, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    return { body, signature: this.sign(body) };
  }

  parseWebhook(rawBody: string, signature: string | undefined): WebhookEvent {
    const expected = this.sign(rawBody);
    if (!signature || signature.length !== expected.length || !timingSafe(signature, expected)) {
      throw new Error('invalid webhook signature');
    }
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (parsed.type === 'charge.succeeded') {
      return {
        type: 'charge.succeeded',
        eventId: String(parsed.eventId),
        providerRef: String(parsed.providerRef),
        paymentId: String(parsed.paymentId),
        amount: BigInt(String(parsed.amount)),
        paidAt: String(parsed.paidAt),
      };
    }
    if (parsed.type === 'charge.failed') {
      return {
        type: 'charge.failed',
        eventId: String(parsed.eventId),
        providerRef: String(parsed.providerRef),
        paymentId: String(parsed.paymentId),
        reason: String(parsed.reason),
      };
    }
    throw new Error('unknown webhook event');
  }
}

function timingSafe(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
