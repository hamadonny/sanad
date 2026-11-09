import type { AdminMemberRow } from '@sanad/api-client';
import Link from 'next/link';
import { Badge, Card, Empty, LoadError, PageHead, Table } from '../../../components/ui';
import { formatDate } from '../../../lib/format';
import { getT, load } from '../../../lib/server';

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q = '', status = '' } = await searchParams;
  const tr = await getT();
  const { t, lang } = tr;
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString();
  const r = await load<AdminMemberRow[]>(`/admin/members${qs ? `?${qs}` : ''}`);
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.members')} />
      <Card>
        <form className="form-row" action="/members">
          <label>
            {t('admin.common.search')}
            <input name="q" defaultValue={q} placeholder={t('admin.members.searchHint')} />
          </label>
          <label style={{ flex: '0 1 180px' }}>
            {t('admin.common.status')}
            <select name="status" defaultValue={status}>
              <option value="">{t('admin.common.all')}</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="BANNED">BANNED</option>
              <option value="DELETED">DELETED</option>
            </select>
          </label>
          <button className="btn secondary" type="submit">
            {t('admin.common.search')}
          </button>
        </form>
      </Card>
      <Card>
        {!r.ok ? (
          <LoadError r={r} t={tr} />
        ) : r.data.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.name'),
              t('admin.common.phone'),
              t('admin.common.status'),
              t('admin.members.kycStatus'),
              t('admin.members.activeCircles'),
              t('admin.members.joined'),
              '',
            ]}
          >
            {r.data.map((m) => (
              <tr key={m.id}>
                <td>
                  <div>
                    {(lang === 'ar' ? m.fullNameAr : m.fullNameEn) ??
                      m.fullNameEn ??
                      m.fullNameAr ??
                      '—'}
                  </div>
                  <div className="muted small">{lang === 'ar' ? m.fullNameEn : m.fullNameAr}</div>
                </td>
                <td>
                  <span className="num">{m.phone}</span>
                </td>
                <td>
                  <Badge value={m.status} t={tr} />
                </td>
                <td>
                  <Badge value={m.kycStatus} t={tr} />
                </td>
                <td className="num">{m.activeCircles}</td>
                <td>{formatDate(m.createdAt, lang)}</td>
                <td className="end">
                  <Link href={`/members/${m.id}`}>{t('admin.common.open')}</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
