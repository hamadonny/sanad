import type { ApiMoney } from '@sanad/api-client';
import { formatKwd, type Fils } from '@sanad/core';
import type { Language } from '@sanad/i18n';

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function localizeDigits(text: string, arabic: boolean): string {
  return arabic ? text.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] as string) : text;
}

/** Thousands separators on the whole-KWD part; always exactly 3 decimals (spec §9.2). */
export function groupKwd(kwd: string): string {
  const [whole = '0', fraction = '000'] = kwd.replace(/^-/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${kwd.startsWith('-') ? '-' : ''}${grouped}.${fraction}`;
}

export interface MoneyFormatOptions {
  language: Language;
  arabicNumerals: boolean;
  /** Include the currency label (default true). */
  currency?: boolean;
}

export function formatMoney(value: ApiMoney | Fils | string, o: MoneyFormatOptions): string {
  const kwd =
    typeof value === 'bigint' ? formatKwd(value) : typeof value === 'string' ? value : value.kwd;
  const amount = localizeDigits(groupKwd(kwd), o.arabicNumerals);
  if (o.currency === false) return amount;
  return o.language === 'ar' ? `${amount} د.ك` : `${amount} KWD`;
}

/** Parse what a member types ("45", "45.5", "٤٥") into fils, or null if invalid. */
export function parseKwdInput(input: string): Fils | null {
  const western = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[,،]/g, '');
  const m = /^(\d{1,9})(?:[.٫](\d{1,3}))?$/.exec(western);
  if (!m) return null;
  return BigInt(m[1] as string) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
}

export interface DateFormatOptions {
  language: Language;
  arabicNumerals: boolean;
  hijri: boolean;
}

/** Calendar date (YYYY-MM-DD, Kuwait) in a friendly form, with optional Hijri date. */
export function formatDate(date: string, o: DateFormatOptions): string {
  const d = new Date(`${date}T12:00:00+03:00`);
  const locale = o.language === 'ar' ? 'ar-KW' : 'en-GB';
  let text: string;
  try {
    text = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kuwait',
    }).format(d);
    if (o.hijri) {
      const h = new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-latn`, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kuwait',
      }).format(d);
      text = `${text} · ${h}`;
    }
  } catch {
    text = date;
  }
  return localizeDigits(text, o.arabicNumerals);
}

/** "2d 4h", "12m 03s" — for auction countdowns. */
export function formatCountdown(ms: number, language: Language): string {
  if (ms <= 0) return language === 'ar' ? 'انتهى' : 'Ended';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const u =
    language === 'ar' ? { d: 'ي', h: 'س', m: 'د', s: 'ث' } : { d: 'd', h: 'h', m: 'm', s: 's' };
  if (d > 0) return `${d}${u.d} ${h}${u.h}`;
  if (h > 0) return `${h}${u.h} ${m}${u.m}`;
  return `${m}${u.m} ${String(sec).padStart(2, '0')}${u.s}`;
}

/** Normalise a Kuwaiti mobile number typed in any common form to +965XXXXXXXX (or null). */
export function normalizeKuwaitPhone(input: string): string | null {
  const digits = input
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[^\d+]/g, '');
  const local = digits.replace(/^(\+965|00965|965)/, '');
  return /^[4569]\d{7}$/.test(local) ? `+965${local}` : null;
}
