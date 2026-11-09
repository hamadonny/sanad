import type { AdminKycRow } from '@sanad/api-client';
import Link from 'next/link';
import { Badge, Card, Empty, LoadError, PageHead, Table, Tabs } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { getT, load } from '../../../lib/server';

export default async function KycPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = 'PENDING_REVIEW' } = await searchParams;
  const tr = await getT();
  const { t, lang } = tr;
  const r = await load<AdminKycRow[]>(`/admin/kyc?status=${encodeURIComponent(status)}`);
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.kyc')} />
      <Tabs
        items={['PENDING_REVIEW', 'APPROVED', 'REJECTED'].map((s) => ({
          href: `/kyc?status=${s}`,
          label: t(
            s === 'PENDING_REVIEW'
              ? 'admin.kyc.queue'
              : s === 'APPROVED'
                ? 'admin.kyc.approvedTab'
                : 'admin.kyc.rejectedTab',
          ),
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
              t('admin.common.name'),
              t('admin.kyc.submitted'),
              t('admin.kyc.documents'),
              t('admin.common.status'),
              '',
            ]}
          >
            {r.data.map((k) => (
              <tr key={k.id}>
                <td>
                  <div>{lang === 'ar' ? k.fullNameAr : k.fullNameEn}</div>
                  <div className="muted small">{lang === 'ar' ? k.fullNameEn : k.fullNameAr}</div>
                </td>
                <td>{formatDateTime(k.submittedAt, lang)}</td>
                <td>{k.hasDocuments ? '✓' : '—'}</td>
                <td>
                  <Badge value={k.status} t={tr} />
                </td>
                <td className="end">
                  <Link href={`/kyc/${k.id}`}>{t('admin.common.open')}</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
