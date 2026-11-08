/**
 * @sanad/api-client — typed client for mobile and admin.
 * Regenerate after API changes:  pnpm --filter @sanad/api openapi && pnpm --filter @sanad/api-client generate
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';

export type { paths } from './schema.js';

export interface ClientOptions {
  baseUrl: string;
  /** Returns the current access token (or null when signed out). */
  getToken?: () => string | null | Promise<string | null>;
  /** Called with the response when the API answers 401, e.g. to refresh tokens. */
  onUnauthorized?: (res: Response) => void;
}

export function createSanadClient(opts: ClientOptions) {
  const client = createClient<paths>({ baseUrl: opts.baseUrl });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await opts.getToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
    onResponse({ response }) {
      if (response.status === 401) opts.onUnauthorized?.(response);
      return response;
    },
  };
  client.use(auth);
  return client;
}

/** Money as the API sends it (D-001): fils string + 3-decimal KWD display string. */
export interface ApiMoney {
  fils: string;
  kwd: string;
}

/** Unique Idempotency-Key for money endpoints (retries must reuse the same key). */
export function newIdempotencyKey(): string {
  const rnd =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `k-${rnd}`;
}
