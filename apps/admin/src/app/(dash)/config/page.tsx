import type { AdminConfigVersion } from '@sanad/api-client';
import { Card, Empty, LoadError, PageHead, Table } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { can } from '../../../lib/nav';
import { getMe, getT, load } from '../../../lib/server';
import { ConfigEditor } from './ConfigEditor';

export default async function ConfigPage() {
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const [active, versions] = await Promise.all([
    load<{ version: number; config: unknown }>('/admin/config'),
    load<AdminConfigVersion[]>('/admin/config/versions'),
  ]);
  if (!active.ok) return <LoadError r={active} t={tr} />;
  const editable = can(me.roles); // super_admin only
  return (
    <div className="stack">
      <PageHead
        title={t('admin.nav.config')}
        sub={t('admin.config.current', { version: active.data.version })}
      />
      <div className="banner warn small">{t('admin.config.legalFlag')}</div>
      <Card title={t('admin.config.editor')}>
        <p className="muted small" style={{ marginTop: 0 }}>
          {t('admin.config.editorHint')}
        </p>
        {!editable ? <p className="banner small">{t('admin.config.onlySuper')}</p> : null}
        <ConfigEditor
          initial={JSON.stringify(active.data.config, null, 2)}
          editable={editable}
          labels={{
            preview: t('admin.config.preview'),
            publish: t('admin.config.publish'),
            notes: t('admin.config.notes'),
            noChanges: t('admin.config.noChanges'),
            changes: t('admin.config.changes'),
            field: t('admin.config.field'),
            before: t('admin.config.before'),
            after: t('admin.config.after'),
            confirm: t('admin.common.confirmCheck'),
          }}
        />
      </Card>
      <Card title={t('admin.config.versions')}>
        {!versions.ok ? (
          <LoadError r={versions} t={tr} />
        ) : versions.data.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              'v',
              t('admin.common.date'),
              t('admin.config.publishedBy'),
              t('admin.config.notes'),
              t('admin.config.changes'),
            ]}
          >
            {versions.data.map((v) => (
              <tr key={v.version}>
                <td className="num">{v.version}</td>
                <td className="small">{formatDateTime(v.publishedAt, lang)}</td>
                <td className="mono">{v.publishedBy ?? '—'}</td>
                <td>{v.notes ?? '—'}</td>
                <td>
                  {Array.isArray(v.diff) && v.diff.length ? (
                    <details>
                      <summary>{v.diff.length}</summary>
                      <pre className="json">{JSON.stringify(v.diff, null, 2)}</pre>
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
