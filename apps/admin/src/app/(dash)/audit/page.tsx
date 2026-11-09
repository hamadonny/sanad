import type { AdminAuditRow } from '@sanad/api-client';
import { Card, Empty, LoadError, PageHead, Table } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { getT, load } from '../../../lib/server';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action = '' } = await searchParams;
  const tr = await getT();
  const { t, lang } = tr;
  const r = await load<AdminAuditRow[]>(
    `/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`,
  );
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.audit')} sub={t('admin.audit.immutable')} />
      <Card>
        <form className="form-row" action="/audit">
          <label>
            {t('admin.audit.filterAction')}
            <input name="action" defaultValue={action} dir="ltr" />
          </label>
          <button className="btn secondary" type="submit">
            {t('admin.common.filter')}
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
              t('admin.common.date'),
              t('admin.audit.actor'),
              t('admin.audit.action'),
              t('admin.audit.entity'),
              t('admin.audit.details'),
              t('admin.audit.ip'),
            ]}
          >
            {r.data.map((a) => (
              <tr key={a.id}>
                <td className="small">{formatDateTime(a.createdAt, lang)}</td>
                <td className="small">
                  {a.actorType}
                  {a.actorEmail ? (
                    <div className="mono">{a.actorEmail}</div>
                  ) : a.actorId ? (
                    <div className="mono">{a.actorId.slice(0, 8)}</div>
                  ) : null}
                </td>
                <td>
                  <span className="badge">{a.action}</span>
                </td>
                <td className="mono">
                  {a.entity ? `${a.entity}:${(a.entityId ?? '').slice(0, 12)}` : '—'}
                </td>
                <td>
                  {a.details ? (
                    <details>
                      <summary>JSON</summary>
                      <pre className="json">{JSON.stringify(a.details, null, 2)}</pre>
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="mono">{a.ip ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
