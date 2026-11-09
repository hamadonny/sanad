import type { AdminLedgerTransaction } from '@sanad/api-client';
import Link from 'next/link';
import { formatDateTime, shortId } from '../lib/format';
import type { Translator } from '../lib/i18n';
import { Empty, Money, Table } from './ui';

/** Ledger transactions with their entries (debit > 0, credit < 0; D-005). */
export function LedgerTable({ txns, t }: { txns: AdminLedgerTransaction[]; t: Translator }) {
  if (txns.length === 0) return <Empty t={t} />;
  return (
    <Table
      head={[
        '#',
        t.t('admin.common.date'),
        t.t('admin.finance.type'),
        t.t('admin.common.circle'),
        t.t('admin.finance.entries'),
      ]}
    >
      {txns.map((x) => (
        <tr key={x.key}>
          <td className="num">{x.seq}</td>
          <td className="small">{formatDateTime(x.createdAt, t.lang)}</td>
          <td>
            <span className="badge">{x.type}</span>
            {x.month ? (
              <span className="muted small"> · {t.t('common.month', { n: x.month })}</span>
            ) : null}
            {x.memo ? <div className="muted small">{x.memo}</div> : null}
          </td>
          <td className="mono">
            {x.circleId ? <Link href={`/circles/${x.circleId}`}>{shortId(x.circleId)}</Link> : '—'}
          </td>
          <td>
            <table>
              <tbody>
                {x.entries.map((e, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ border: 0, padding: '2px 6px' }}>
                      {e.account}
                    </td>
                    <td className="end" style={{ border: 0, padding: '2px 6px' }}>
                      <Money m={e.amount} lang={t.lang} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ))}
    </Table>
  );
}
