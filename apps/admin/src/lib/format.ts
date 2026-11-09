import type { ApiMoney } from '@sanad/api-client';
import type { Language } from '@sanad/i18n';

/** Thousands separators on the integer part of a 3-decimal KWD string ("-1234.500"). */
export function groupKwd(kwd: string): string {
  const neg = kwd.startsWith('-');
  const [int = '0', dec = '000'] = (neg ? kwd.slice(1) : kwd).split('.');
  return `${neg ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

/** Money always shows 3 decimals and the currency (spec §0.5). Latin digits for staff. */
export function formatMoney(m: ApiMoney | null | undefined, lang: Language): string {
  if (!m) return '—';
  return `${groupKwd(m.kwd)} ${lang === 'ar' ? 'د.ك' : 'KWD'}`;
}

const locale = (lang: Language) => (lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB');

/** Date-time in Kuwait time. */
export function formatDateTime(iso: string | null | undefined, lang: Language): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: 'Asia/Kuwait',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** Calendar date (YYYY-MM-DD from the API, already a Kuwait date). */
export function formatDate(date: string | null | undefined, lang: Language): string {
  if (!date) return '—';
  const d = date.length === 10 ? new Date(`${date}T12:00:00+03:00`) : new Date(date);
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: 'Asia/Kuwait',
    dateStyle: 'medium',
  }).format(d);
}

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');

/** "1,250.500" KWD typed by staff → integer fils string, or null if invalid (max 3 decimals). */
export function kwdToFils(input: string): string | null {
  const s = input
    .trim()
    .replace(/,/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const m = /^(\d{1,10})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m?.[1]) return null;
  const fils = BigInt(m[1]) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0') || '0');
  return fils.toString();
}
