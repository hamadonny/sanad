/**
 * Hand-written, typed client used by the mobile app (and later the admin). Handles the bearer
 * token, one automatic refresh on 401, Idempotency-Key on money endpoints and typed errors.
 */
import type {
  AuctionView,
  CircleDetail,
  CircleSummary,
  ContractResponse,
  DrawView,
  IntentResponse,
  KycStatusResponse,
  MeResponse,
  NotificationView,
  OptionsResponse,
  OtpRequestResponse,
  SignatureView,
  AddendumView,
  LegalStatus,
  OtpVerifyResponse,
  PaymentView,
  ReplacementOffer,
  ScheduleView,
  TokenPair,
} from './responses.js';
import type { FaqItem } from './admin.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  get(): Promise<TokenPair | null> | TokenPair | null;
  set(tokens: TokenPair | null): Promise<void> | void;
}

export interface SanadApiOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Called when refreshing fails, i.e. the user must sign in again. */
  onSignedOut?: () => void;
  /** Extra headers (language, device id…). */
  headers?: () => Record<string, string>;
  fetch?: typeof fetch;
}

export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export function newIdempotencyKey(): string {
  const rnd =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `k-${rnd}`.replace(/[^A-Za-z0-9_-]/g, '');
}

export class SanadApi {
  private refreshing: Promise<boolean> | null = null;
  private readonly f: typeof fetch;

  constructor(private readonly opts: SanadApiOptions) {
    this.f = opts.fetch ?? ((...a) => fetch(...a));
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init: { idempotencyKey?: string; auth?: boolean; raw?: boolean } = {},
  ): Promise<T> {
    const send = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(this.opts.headers?.() ?? {}),
      };
      const tokens = init.auth === false ? null : await this.opts.tokens.get();
      if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
      if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
      let payload: FormData | string | undefined;
      if (body instanceof FormData) payload = body;
      else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      return this.f(`${this.opts.baseUrl}${path}`, {
        method,
        headers,
        ...(payload !== undefined ? { body: payload } : {}),
      });
    };
    let res = await send();
    if (res.status === 401 && init.auth !== false && (await this.refresh())) res = await send();
    if (!res.ok) {
      let err: { code?: string; message?: string } = {};
      try {
        err = (await res.json()) as typeof err;
      } catch {
        /* non-JSON error */
      }
      throw new ApiError(
        res.status,
        err.code ?? `HTTP_${res.status}`,
        err.message ?? res.statusText,
      );
    }
    if (init.raw) return res as unknown as T;
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Single-flight refresh. Returns false (and signs out) if the refresh token is rejected. */
  private refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const current = await this.opts.tokens.get();
        if (!current) return false;
        const res = await this.f(`${this.opts.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) {
          await this.opts.tokens.set(null);
          this.opts.onSignedOut?.();
          return false;
        }
        await this.opts.tokens.set((await res.json()) as TokenPair);
        return true;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // ── auth ──
  requestOtp(phone: string, language: 'ar' | 'en') {
    return this.request<OtpRequestResponse>(
      'POST',
      '/auth/otp/request',
      { phone, language },
      { auth: false },
    );
  }
  async verifyOtp(phone: string, code: string): Promise<OtpVerifyResponse> {
    return this.signIn('/auth/otp/verify', { phone, code });
  }
  /** Development only: sign in an allow-listed phone without a code. */
  async devLogin(phone: string): Promise<OtpVerifyResponse> {
    return this.signIn('/auth/dev-login', { phone });
  }
  private async signIn(path: string, body: Record<string, string>): Promise<OtpVerifyResponse> {
    const r = await this.request<OtpVerifyResponse>('POST', path, body, { auth: false });
    await this.opts.tokens.set({
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      expiresIn: r.expiresIn,
    });
    return r;
  }
  async logout(): Promise<void> {
    const t = await this.opts.tokens.get();
    if (t)
      await this.request<undefined>(
        'POST',
        '/auth/logout',
        { refreshToken: t.refreshToken },
        { auth: false },
      ).catch(() => undefined);
    await this.opts.tokens.set(null);
  }

  // ── me ──
  me = () => this.request<MeResponse>('GET', '/me');
  /** Public FAQ edited in the admin dashboard. */
  faq = () => this.request<FaqItem[]>('GET', '/content/faq', undefined, { auth: false });
  setLanguage = (language: 'ar' | 'en') => this.request<MeResponse>('PATCH', '/me', { language });
  deleteAccount = () => this.request<undefined>('DELETE', '/me');
  kycStatus = () => this.request<KycStatusResponse>('GET', '/kyc/status');
  submitKyc(
    fields: Record<string, string>,
    files: Partial<Record<'front' | 'back' | 'selfie', UploadFile>>,
  ) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    for (const [k, f] of Object.entries(files)) if (f) form.append(k, f as unknown as Blob);
    return this.request<{ id: string; status: string }>('POST', '/kyc/submissions', form);
  }
  contract = () => this.request<ContractResponse>('GET', '/contracts/current');
  /** E-signature step 1: SMS a signing code (development: returned as devCode). */
  requestSignCode = (version: number, language: 'ar' | 'en') =>
    this.request<OtpRequestResponse>('POST', '/contracts/sign/request', { version, language });
  /** E-signature step 2: sign this version with the code. */
  signContract = (version: number, code: string) =>
    this.request<{ version: number; documentHash: string; signatureId: string }>(
      'POST',
      '/contracts/sign',
      { version, code },
    );
  signatures = () => this.request<SignatureView[]>('GET', '/contracts/signatures');
  signatureUrl = (id: string) => `${this.opts.baseUrl}/contracts/signatures/${id}/pdf`;
  pendingAddenda = () => this.request<string[]>('GET', '/contracts/pending-addenda');
  addendum = (circleId: string) =>
    this.request<AddendumView>('GET', `/circles/${circleId}/addendum`);
  acknowledgeAddendum = (circleId: string, documentHash: string) =>
    this.request<AddendumView>('POST', `/circles/${circleId}/addendum/ack`, { documentHash });
  addendumUrl = (circleId: string) => `${this.opts.baseUrl}/circles/${circleId}/addendum/pdf`;
  legalStatus = () =>
    this.request<LegalStatus>('GET', '/content/legal-status', undefined, { auth: false });
  legalDocUrl = (id: string) => `${this.opts.baseUrl}/content/legal-docs/${id}/file`;
  registerDevice = (pushToken: string, platform: 'ios' | 'android') =>
    this.request<undefined>('POST', '/devices', { pushToken, platform });
  notifications = () => this.request<NotificationView[]>('GET', '/notifications');
  markRead = (id: string) => this.request<undefined>('POST', `/notifications/${id}/read`);
  supportTicket = (subject: string, body: string) =>
    this.request<{ id: string; status: string }>('POST', '/support/tickets', { subject, body });

  // ── circles ──
  options = () => this.request<OptionsResponse>('GET', '/circles/options');
  joinQueue = (monthlyKwd: number, idempotencyKey: string) =>
    this.request<IntentResponse>('POST', '/circles/queue', { monthlyKwd }, { idempotencyKey });
  leaveQueue = (circleId: string) =>
    this.request<undefined>('DELETE', `/circles/queue/${circleId}`);
  circles = () => this.request<CircleSummary[]>('GET', '/circles');
  circle = (id: string) => this.request<CircleDetail>('GET', `/circles/${id}`);
  auction = (id: string) => this.request<AuctionView>('GET', `/circles/${id}/auction`);
  bid = (id: string, spot: number, amountFils: string) =>
    this.request<AuctionView>('POST', `/circles/${id}/auction/bids`, { spot, amountFils });
  draw = (id: string) => this.request<DrawView>('GET', `/circles/${id}/draw`);
  schedule = (id: string) => this.request<ScheduleView>('GET', `/circles/${id}/schedule`);
  replacements = () => this.request<ReplacementOffer[]>('GET', '/circles/replacements');

  // ── payments ──
  payContribution = (circleId: string, month: number, idempotencyKey: string) =>
    this.request<IntentResponse>(
      'POST',
      '/payments/intents',
      { purpose: 'CONTRIBUTION', circleId, month },
      { idempotencyKey },
    );
  payReplacement = (circleId: string, spot: number, idempotencyKey: string) =>
    this.request<IntentResponse>(
      'POST',
      '/payments/intents',
      { purpose: 'REPLACEMENT', circleId, spot },
      { idempotencyKey },
    );
  payments = () => this.request<PaymentView[]>('GET', '/payments');
  /** DEV ONLY: confirm a mock payment (stands in for the gateway's checkout page). */
  devConfirm = (paymentId: string) =>
    this.request<PaymentView>('POST', `/payments/dev/${paymentId}/confirm`);
  receiptUrl = (paymentId: string) => `${this.opts.baseUrl}/payments/${paymentId}/receipt`;
  async authHeader(): Promise<Record<string, string>> {
    const t = await this.opts.tokens.get();
    return t ? { Authorization: `Bearer ${t.accessToken}` } : {};
  }
}
