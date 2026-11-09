import type {
  AdminDisbursement,
  AdminDisbursements,
  AdminDueRow,
  AdminPaymentsBoard,
} from '@sanad/api-client';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '../../../components/ActionForm';
import {
  Badge,
  Card,
  Empty,
  LoadError,
  Money,
  PageHead,
  Table,
  Tabs,
} from '../../../components/ui';
import type { Translator } from '../../../lib/i18n';
import { formatDate, formatDateTime, shortId } from '../../../lib/format';
import { can } from '../../../lib/nav';
import { getMe, getT, load } from '../../../lib/server';
import { retryDisbursement } from '../actions';

function DueTable({ rows, tr }: { rows: AdminDueRow[]; tr: Translator }) {
  const { t, lang } = tr;
  if (rows.length === 0) return <Empty t={tr} />;
  return (
    <Table
      head={[
        t('admin.common.member'),
        t('admin.common.phone'),
        t('admin.common.circle'),
        t('admin.common.month'),
        t('admin.common.amount'),
        t('admin.circles.due'),
        t('admin.payments.daysLate'),
        t('admin.payments.defaultsOn'),
      ]}
    >
      {rows.map((r) => (
        <tr key={`${r.circleId}-${r.spot}-${r.month}`}>
          <td>{r.userId ? <Link href={`/members/${r.userId}`}>{r.name ?? '—'}</Link> : '—'}</td>
          <td>
            <span className="num">{r.phone ?? '—'}</span>
          </td>
          <td className="mono">
            <Link href={`/circles/${r.circleId}`}>{shortId(r.circleId)}</Link>
          </td>
          <td className="num">{r.month}</td>
          <td>
            <Money m={r.amount} lang={lang} />
          </td>
          <td>{formatDate(r.dueDate, lang)}</td>
          <td className="num">
            {r.daysLate > 0 ? <span className="badge warn">{r.daysLate}</span> : '0'}
          </td>
          <td>{formatDate(r.defaultsOn, lang)}</td>
        </tr>
      ))}
    </Table>
  );
}

function DisbursementTable({
  rows,
  kind,
  tr,
  canRetry,
}: {
  rows: AdminDisbursement[];
  kind: 'payout' | 'refund';
  tr: Translator;
  canRetry: boolean;
}) {
  const { t, lang } = tr;
  if (rows.length === 0) return <Empty t={tr} />;
  return (
    <Table
      head={[
        t('admin.common.date'),
        t('admin.common.member'),
        t('admin.payments.kind'),
        t('admin.common.amount'),
        t('admin.common.status'),
        t('admin.payments.attempts'),
        t('admin.payments.lastError'),
        '',
      ]}
    >
      {rows.map((d) => (
        <tr key={d.id}>
          <td className="small">{formatDateTime(d.createdAt, lang)}</td>
          <td className="mono">
            <Link href={`/members/${d.userId}`}>{shortId(d.userId)}</Link>
          </td>
          <td>
            {d.kind}
            {d.month ? ` · ${t('common.month', { n: d.month })}` : ''}
          </td>
          <td>
            <Money m={d.amount} lang={lang} />
          </td>
          <td>
            <Badge value={d.status} t={tr} />
          </td>
          <td className="num">{d.attempts}</td>
          <td className="small muted">{d.lastError ?? '—'}</td>
          <td className="end">
            {canRetry && d.status === 'FAILED' ? (
              <ActionForm action={retryDisbursement} inline>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={d.id} />
                <SubmitButton small>{t('admin.payments.retry')}</SubmitButton>
              </ActionForm>
            ) : null}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ failed?: string }>;
}) {
  const { failed } = await searchParams;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const [board, disb] = await Promise.all([
    load<AdminPaymentsBoard>('/admin/payments/board'),
    load<AdminDisbursements>(`/admin/disbursements${failed ? '?status=FAILED' : ''}`),
  ]);
  if (!board.ok) return <LoadError r={board} t={tr} />;
  const b = board.data;
  const canRetry = can(me.roles, 'ops', 'finance');
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.payments')} sub={formatDate(b.today, lang)} />
      <Card title={`${t('admin.payments.dueToday')} (${b.dueToday.length})`}>
        <DueTable rows={b.dueToday} tr={tr} />
      </Card>
      <Card title={`${t('admin.payments.late')} (${b.late.length})`}>
        <DueTable rows={b.late} tr={tr} />
      </Card>
      <div className="two">
        <Card title={t('admin.payments.upcoming')}>
          {b.upcomingPayouts.length === 0 ? (
            <Empty t={tr} />
          ) : (
            <Table
              head={[
                t('admin.circles.payout'),
                t('admin.circles.recipient'),
                t('admin.common.circle'),
                t('admin.common.month'),
                t('admin.payments.expected'),
              ]}
            >
              {b.upcomingPayouts.map((p) => (
                <tr key={`${p.circleId}-${p.month}`}>
                  <td>{formatDate(p.payoutDate, lang)}</td>
                  <td>
                    {p.userId ? <Link href={`/members/${p.userId}`}>{p.name ?? '—'}</Link> : '—'}
                  </td>
                  <td className="mono">
                    <Link href={`/circles/${p.circleId}`}>{shortId(p.circleId)}</Link>
                  </td>
                  <td className="num">{p.month}</td>
                  <td>
                    <Money m={p.expected} lang={lang} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={t('admin.payments.defaulted')}>
          {b.defaulted.length === 0 ? (
            <Empty t={tr} />
          ) : (
            <Table
              head={[
                t('admin.common.date'),
                t('admin.common.member'),
                t('admin.payments.kind'),
                t('admin.common.circle'),
              ]}
            >
              {b.defaulted.map((d) => (
                <tr key={d.id}>
                  <td className="small">{formatDateTime(d.createdAt, lang)}</td>
                  <td>
                    <Link href={`/members/${d.userId}`}>{d.name ?? shortId(d.userId)}</Link>
                  </td>
                  <td>
                    <Badge value={d.kind} />
                  </td>
                  <td className="mono">
                    <Link href={`/circles/${d.circleId}`}>{shortId(d.circleId)}</Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Tabs
        items={[
          { href: '/payments', label: t('admin.common.all'), active: !failed },
          { href: '/payments?failed=1', label: t('admin.payments.onlyFailed'), active: !!failed },
        ]}
      />
      {!disb.ok ? (
        <LoadError r={disb} t={tr} />
      ) : (
        <>
          <Card title={t('admin.payments.payouts')}>
            <DisbursementTable rows={disb.data.payouts} kind="payout" tr={tr} canRetry={canRetry} />
          </Card>
          <Card title={t('admin.payments.refunds')}>
            <DisbursementTable rows={disb.data.refunds} kind="refund" tr={tr} canRetry={canRetry} />
          </Card>
        </>
      )}
    </div>
  );
}
