import type { AdminLegalCase } from '@sanad/api-client';
import Link from 'next/link';
import { Badge, Card, Empty, LoadError, Money, PageHead, Table } from '../../../components/ui';
import { formatDate, shortId } from '../../../lib/format';
import { getT, load } from '../../../lib/server';

export default async function LegalPage() {
  const tr = await getT();
  const { t, lang } = tr;
  const r = await load<AdminLegalCase[]>('/admin/legal/cases');
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.legal')} />
      <Card title={t('admin.legal.cases')}>
        {!r.ok ? (
          <LoadError r={r} t={tr} />
        ) : r.data.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.createdAt'),
              t('admin.common.member'),
              t('admin.common.status'),
              t('admin.legal.gross'),
              t('admin.legal.holdbackApplied'),
              t('admin.legal.net'),
              t('admin.legal.recovered'),
              t('admin.legal.outstanding'),
              '',
            ]}
          >
            {r.data.map((c) => (
              <tr key={c.id}>
                <td>{formatDate(c.createdAt, lang)}</td>
                <td>
                  <Link href={`/members/${c.userId}`}>{c.name ?? shortId(c.userId)}</Link>
                </td>
                <td>
                  <Badge value={c.status} t={tr} scope="admin.legal.statuses" />
                </td>
                <td>
                  <Money m={c.grossOwed} lang={lang} />
                </td>
                <td>
                  <Money m={c.holdbackApplied} lang={lang} />
                </td>
                <td>
                  <Money m={c.netClaim} lang={lang} />
                </td>
                <td>
                  <Money m={c.recovered} lang={lang} />
                </td>
                <td>
                  <strong>
                    <Money m={c.outstanding} lang={lang} />
                  </strong>
                </td>
                <td className="end">
                  <Link href={`/legal/${c.id}`}>{t('admin.common.open')}</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
