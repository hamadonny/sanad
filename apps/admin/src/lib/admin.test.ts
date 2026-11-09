import { describe, expect, it, vi } from 'vitest';
import { formatMoney, groupKwd, kwdToFils } from './format';
import { makeT, parseLang, translate } from './i18n';
import { can, canSee, visibleNav } from './nav';
import { refreshOnce } from './refresh';
import { decodeToken, needsRefresh } from './session';

const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

describe('session tokens', () => {
  it('decodes claims and refreshes before expiry', () => {
    const now = 1_800_000_000_000;
    const tok = jwt({ sub: 'a1', exp: now / 1000 + 600, roles: ['ops'] });
    expect(decodeToken(tok)).toEqual({ sub: 'a1', exp: now / 1000 + 600, roles: ['ops'] });
    expect(needsRefresh(tok, now)).toBe(false);
    expect(needsRefresh(tok, now + 590_000)).toBe(true);
    expect(needsRefresh(undefined, now)).toBe(true);
    expect(decodeToken('garbage')).toBeNull();
  });
});

describe('refresh is single-flight (rotating refresh tokens must not be reused)', () => {
  it('parallel calls with the same token share one API call', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ accessToken: 'a', refreshToken: 'r2', expiresIn: 900 })),
    ) as unknown as typeof fetch;
    const [a, b] = await Promise.all([refreshOnce('rt-1', fetcher), refreshOnce('rt-1', fetcher)]);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('a rejected refresh returns null', async () => {
    const fetcher = vi.fn(
      async () => new Response('{}', { status: 401 }),
    ) as unknown as typeof fetch;
    expect(await refreshOnce('rt-bad', fetcher)).toBeNull();
  });
});

describe('role-based navigation (mirrors the API roles)', () => {
  it('super admin sees everything, viewers never see audit or KYC', () => {
    expect(visibleNav(['super_admin']).map((n) => n.key)).toContain('audit');
    expect(canSee(['viewer'], 'audit')).toBe(false);
    expect(canSee(['viewer'], 'kyc')).toBe(false);
    expect(canSee(['viewer'], 'finance')).toBe(true);
    expect(canSee(['kyc_reviewer'], 'members')).toBe(false);
    expect(canSee(['kyc_reviewer'], 'kyc')).toBe(true);
  });
  it('actions', () => {
    expect(can(['finance'], 'ops')).toBe(false);
    expect(can(['super_admin'], 'ops')).toBe(true);
    expect(can(['ops'])).toBe(false); // super_admin-only (config)
  });
});

describe('money input and display (integer fils, 3 decimals)', () => {
  it('parses KWD to fils without floats', () => {
    expect(kwdToFils('1,250.5')).toBe('1250500');
    expect(kwdToFils('٥٠٠٠')).toBe('5000000');
    expect(kwdToFils('0.001')).toBe('1');
    expect(kwdToFils('1.2345')).toBeNull();
    expect(kwdToFils('-5')).toBeNull();
  });
  it('formats with separators and currency', () => {
    expect(groupKwd('-1234567.500')).toBe('-1,234,567.500');
    expect(formatMoney({ fils: '955000', kwd: '955.000' }, 'ar')).toBe('955.000 د.ك');
    expect(formatMoney({ fils: '1000000', kwd: '1000.000' }, 'en')).toBe('1,000.000 KWD');
  });
});

describe('admin i18n', () => {
  it('Arabic is default and right-to-left; English is LTR', () => {
    expect(parseLang(undefined)).toBe('ar');
    expect(makeT('ar').dir).toBe('rtl');
    expect(makeT('en').dir).toBe('ltr');
    expect(translate('ar', 'admin.title')).toBe('لوحة تحكم سند');
    expect(translate('en', 'admin.legal.generated', { date: 'x' })).toBe('Generated x');
    expect(translate('en', 'admin.nope')).toBe('admin.nope');
  });
});
