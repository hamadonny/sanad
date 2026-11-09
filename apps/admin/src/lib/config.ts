/** Where the admin server reaches the API (server-side only, never exposed to the browser). */
export const API_URL = (
  process.env.ADMIN_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');

/** Dev conveniences (2FA autofill) only when the API also runs with DEV_ENDPOINTS. */
export const IS_DEV = process.env.NODE_ENV !== 'production';
