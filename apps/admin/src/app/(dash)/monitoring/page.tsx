import type { AdminAnalytics, AdminErrorGroup } from '@sanad/api-client';
import { Card, Empty, LoadError, PageHead, Table, Tabs } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { can } from '../../../lib/nav';
import { getMe, getT, load } from '../../../lib/server';

/** The member journey, in order, for the funnel. */
const FUNNEL = [
  'app_open',
  'otp_requested',
  'signed_in',
  'kyc_submitted',
  'join_viewed',
  'contract_signed',
  'payment_completed',
] as const;
const OTHER = [
  'bid_placed',
  'addendum_confirmed',
  'draw_verified',
  'receipt_downloaded',
  'support_ticket',
  'payment_started',
  'onboarding_language',
];

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days = '30' } = await searchParams;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const a = await load<AdminAnalytics>(
    `/admin/monitoring/analytics?days=${encodeURIComponent(days)}`,
  );
  const errors = can(me.roles, 'ops')
    ? await load<AdminErrorGroup[]>('/admin/monitoring/errors?days=7')
    : null;
  const max = a.ok ? Math.max(1, ...FUNNEL.map((e) => a.data.totals[e] ?? 0)) : 1;
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.monitoring')} sub={t('admin.monitoring.privacy')} />
      <Tabs
        items={['7', '30', '90'].map((d) => ({
          href: `/monitoring?days=${d}`,
          label: t('admin.monitoring.days', { n: d }),
          active: days === d,
        }))}
      />
      <div className="two">
        <Card title={t('admin.monitoring.funnel')}>
          {!a.ok ? (
            <LoadError r={a} t={tr} />
          ) : (
            FUNNEL.map((e) => {
              const n = a.data.totals[e] ?? 0;
              return (
                <div key={e} style={{ marginBottom: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{t(`admin.monitoring.events.${e}`)}</span>
                    <span className="num">{n}</span>
                  </div>
                  <div className="meter">
                    <span style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </Card>
        <Card title={t('admin.monitoring.other')}>
          {a.ok ? (
            <Table head={[t('admin.monitoring.event'), t('admin.common.total')]}>
              {OTHER.map((e) => (
                <tr key={e}>
                  <td>{t(`admin.monitoring.events.${e}`)}</td>
                  <td className="num">{a.data.totals[e] ?? 0}</td>
                </tr>
              ))}
            </Table>
          ) : null}
        </Card>
      </div>
      {errors ? (
        <Card title={t('admin.monitoring.errors')}>
          {!errors.ok ? (
            <LoadError r={errors} t={tr} />
          ) : errors.data.length === 0 ? (
            <Empty t={tr} />
          ) : (
            <Table
              head={[
                t('admin.monitoring.source'),
                t('admin.monitoring.message'),
                t('admin.monitoring.count'),
                t('admin.monitoring.lastSeen'),
                '',
              ]}
            >
              {errors.data.map((g) => (
                <tr key={`${g.fingerprint}-${g.source}`}>
                  <td>
                    <span className="badge">{g.source}</span>
                    <div className="muted small">{[...g.platforms, ...g.versions].join(' · ')}</div>
                  </td>
                  <td className="mono" style={{ maxWidth: 420 }}>
                    {g.message}
                    {g.context ? <div className="muted small">{g.context}</div> : null}
                  </td>
                  <td className="num">{g.count}</td>
                  <td className="small">{formatDateTime(g.lastSeen, lang)}</td>
                  <td>
                    {g.stack ? (
                      <details>
                        <summary>stack</summary>
                        <pre className="json">{g.stack}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}
