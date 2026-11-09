/** Server-friendly UI pieces for the dashboard. */
import type { ApiMoney } from '@sanad/api-client';
import type { Language } from '@sanad/i18n';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatMoney } from '../lib/format';
import type { Translator } from '../lib/i18n';
import type { Loaded } from '../lib/server';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-115 -115 230 200" aria-hidden="true">
      <g>
        {[
          'M100.00,0.00 A100,100 0 0 0 92.07,-39.03 L53.40,-22.64 A58,58 0 0 1 58.00,0.00 Z',
          'M89.75,-44.11 A100,100 0 0 0 65.42,-75.63 L37.94,-43.87 A58,58 0 0 1 52.05,-25.58 Z',
          'M61.09,-79.17 A100,100 0 0 0 25.35,-96.73 L14.70,-56.11 A58,58 0 0 1 35.43,-45.92 Z',
          'M-25.35,-96.73 A100,100 0 0 0 -61.09,-79.17 L-35.43,-45.92 A58,58 0 0 1 -14.70,-56.11 Z',
          'M-65.42,-75.63 A100,100 0 0 0 -89.75,-44.11 L-52.05,-25.58 A58,58 0 0 1 -37.94,-43.87 Z',
          'M-92.07,-39.03 A100,100 0 0 0 -100.00,-0.00 L-58.00,-0.00 A58,58 0 0 1 -53.40,-22.64 Z',
        ].map((d) => (
          <path key={d} d={d} fill="currentColor" />
        ))}
        <path
          d="M19.91,-98.00 A100,100 0 0 0 -19.91,-98.00 L-11.55,-56.84 A58,58 0 0 1 11.55,-56.84 Z"
          fill="#eb5e28"
        />
        <rect x="-100" y="6" width="42" height="64" rx="5" fill="currentColor" />
        <rect x="58" y="6" width="42" height="64" rx="5" fill="currentColor" />
      </g>
    </svg>
  );
}

export function PageHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: ReactNode | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="row no-print">{children}</div> : null}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {title || action ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode | undefined;
  tone?: 'accent' | 'warn' | 'bad' | undefined;
  href?: string | undefined;
}) {
  const body = (
    <div className={`stat ${tone ?? ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function Money({ m, lang }: { m: ApiMoney | null | undefined; lang: Language }) {
  const neg = m?.fils.startsWith('-');
  return <span className={`num ${neg ? 'neg' : ''}`}>{formatMoney(m, lang)}</span>;
}

const GOOD = new Set(['ACTIVE', 'APPROVED', 'PAID', 'SENT', 'SUCCEEDED', 'APPLIED', 'CLOSED_OK']);
const WARN = new Set([
  'PENDING',
  'PENDING_REVIEW',
  'FORMING',
  'AUCTION',
  'DRAWING',
  'CLOSING',
  'OPEN',
  'IN_PROGRESS',
  'UNPAID',
  'COVERED',
  'QUEUED',
  'SENT_TO_LAWYER',
  'FILED',
  'JUDGMENT',
  'RECOVERING',
]);
const BAD = new Set([
  'FAILED',
  'BANNED',
  'REJECTED',
  'DEFAULTED',
  'LATE',
  'CANCELLED',
  'POST_PAYOUT',
  'PRE_PAYOUT',
  'REFUND_REQUIRED',
]);

/** Status chip; label is translated when a translation exists, otherwise the raw code. */
export function Badge({
  value,
  t,
  scope,
}: {
  value: string;
  t?: Translator | undefined;
  scope?: string | undefined;
}) {
  const tone = GOOD.has(value) ? 'good' : BAD.has(value) ? 'bad' : WARN.has(value) ? 'warn' : '';
  let label = value;
  if (t) {
    for (const key of [scope ? `${scope}.${value}` : null, `status.${value}`]) {
      if (!key) continue;
      const tr = t.t(key);
      if (tr !== key) {
        label = tr;
        break;
      }
    }
  }
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function Empty({ t }: { t: Translator }) {
  return <p className="muted small">{t.t('admin.common.none')}</p>;
}

export function LoadError({ r, t }: { r: Extract<Loaded<unknown>, { ok: false }>; t: Translator }) {
  if (r.status === 403) return <div className="banner warn">{t.t('admin.common.noAccess')}</div>;
  return <div className="banner bad">{t.t('admin.common.error', { message: r.message })}</div>;
}

export function Table({
  head,
  children,
  empty,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: boolean | undefined;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty ? <p className="muted small">—</p> : null}
    </div>
  );
}

export function Tabs({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav className="tabs no-print">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? 'true' : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
