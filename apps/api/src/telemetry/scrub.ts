/**
 * Remove personal data from free text before it is stored or sent anywhere (spec §15: no PII
 * in logs or analytics). Applied to every error message, stack and context.
 */
const RULES: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [token]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\+?(?:00)?965[\s-]?[4569]\d{3}[\s-]?\d{4}/g, '[phone]'],
  [/\b\d{12}\b/g, '[civil-id]'],
  [/\b[4569]\d{7}\b/g, '[phone]'],
  [
    /("?(?:password|totp|code|otp|refreshToken|accessToken|civilIdNumber)"?\s*[:=]\s*)"?[^",}\s]+"?/gi,
    '$1[redacted]',
  ],
];

export function scrub(text: string | null | undefined, max = 2000): string | null {
  if (text === null || text === undefined) return null;
  let out = String(text);
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}
