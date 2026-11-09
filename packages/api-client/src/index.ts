/**
 * @sanad/api-client — typed access to the Sanad API for mobile and admin.
 *
 * - `SanadApi`: hand-written client with typed responses (`responses.ts`), refresh and errors.
 * - `createSanadClient` / `paths`: low-level client generated from openapi.json.
 *   Regenerate after API changes: pnpm --filter @sanad/api openapi && pnpm --filter @sanad/api-client generate
 */
import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

export type { paths } from './schema.js';
export * from './client.js';
export type * from './responses.js';
export type * from './admin.js';

export function createSanadClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}
