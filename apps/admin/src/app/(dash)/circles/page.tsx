import type { AdminCircleRow } from '@sanad/api-client';
import Link from 'next/link';
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
import { formatDate, shortId } from '../../../lib/format';
import { getT, load } from '../../../lib/server';

const STATUSES = ['', 'FORMING', 'AUCTION', 'DRAWING', 'ACTIVE', 'CLOSING', 'CLOSED', 'CANCELLED'];

export default async function CirclesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = '' } = await searchParams;
  const tr = await getT();
  const { t, lang } = tr;
  const r = await load<AdminCircleRow[]>(
    `/admin/circles${status ? `?status=${encodeURIComponent(status)}` : ''}`,
  );
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.circles')} />
      <Tabs
        items={STATUSES.map((s) => ({
          href: s ? `/circles?status=${s}` : '/circles',
          label: s ? t(`status.${s}`) : t('admin.common.all'),
          active: status === s,
        }))}
      />
      <Card>
        {!r.ok ? (
          <LoadError r={r} t={tr} />
        ) : r.data.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.circle'),
              t('admin.common.status'),
              t('admin.circles.monthly'),
              t('admin.circles.filled'),
              t('admin.circles.start'),
              '',
            ]}
          >
            {r.data.map((c) => (
              <tr key={c.id}>
                <td className="mono">{shortId(c.id)}</td>
                <td>
                  <Badge value={c.status} t={tr} />
                </td>
                <td>
                  <Money m={c.monthly} lang={lang} />
                </td>
                <td className="num">
                  {c.filled} / {c.members}
                </td>
                <td>{formatDate(c.startDate, lang)}</td>
                <td className="end">
                  <Link href={`/circles/${c.id}`}>{t('admin.common.open')}</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
