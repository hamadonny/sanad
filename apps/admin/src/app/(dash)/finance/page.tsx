import type { AdminLedgerTransaction, AdminRevenueReport, ApiMoney } from '@sanad/api-client';
import { TRANSACTION_TYPES } from '@sanad/core';
import { LedgerTable } from '../../../components/LedgerTable';
import { Card, Empty, LoadError, Money, PageHead, Table } from '../../../components/ui';
import { shortId } from '../../../lib/format';
import { can } from '../../../lib/nav';
import { getMe, getT, load } from '../../../lib/server';

const TYPES = ['', ...TRANSACTION_TYPES];

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; account?: string; circleId?: string }>;
}) {
  const sp = await searchParams;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const qs = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  ).toString();
  const [accounts, revenue, ledger] = await Promise.all([
    load<{ account: string; balance: ApiMoney }[]>('/admin/ledger/accounts'),
    load<AdminRevenueReport>('/admin/finance/revenue'),
    load<AdminLedgerTransaction[]>(`/admin/ledger/transactions${qs ? `?${qs}` : ''}`),
  ]);
  const exportable = can(me.roles, 'finance');
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.finance')}>
        {exportable ? (
          <>
            <span className="muted small">{t('admin.finance.exports')}:</span>
            <a className="btn secondary small" href="/files/export/ledger">
              {t('admin.finance.exportLedger')}
            </a>
            <a className="btn secondary small" href="/files/export/accounts">
              {t('admin.finance.exportAccounts')}
            </a>
            <a className="btn secondary small" href="/files/export/revenue">
              {t('admin.finance.exportRevenue')}
            </a>
          </>
        ) : null}
      </PageHead>
      <div>
        <Card title={t('admin.finance.balances')}>
          {!accounts.ok ? (
            <LoadError r={accounts} t={tr} />
          ) : accounts.data.length === 0 ? (
            <Empty t={tr} />
          ) : (
            <Table head={[t('admin.finance.account'), t('admin.finance.balance')]}>
              {accounts.data.map((a) => (
                <tr key={a.account}>
                  <td className="mono">
                    <a href={`/finance?account=${encodeURIComponent(a.account)}`}>{a.account}</a>
                  </td>
                  <td className="end">
                    <Money m={a.balance} lang={lang} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title={t('admin.finance.revenue')}>
        {!revenue.ok ? (
          <LoadError r={revenue} t={tr} />
        ) : (
          <>
            <div className="grid" style={{ marginBottom: 14 }}>
              <div className="stat">
                <div className="label">{t('admin.finance.revenueTotal')}</div>
                <div className="value">
                  <Money m={revenue.data.totals.revenue} lang={lang} />
                </div>
              </div>
              <div className="stat">
                <div className="label">{t('admin.overview.memberShortfall')}</div>
                <div className="value">
                  <Money m={revenue.data.totals.memberShortfall} lang={lang} />
                </div>
              </div>
              <div className="stat">
                <div className="label">{t('admin.overview.charity')}</div>
                <div className="value">
                  <Money m={revenue.data.totals.charityPayable} lang={lang} />
                </div>
              </div>
            </div>
            {revenue.data.rows.length === 0 ? (
              <Empty t={tr} />
            ) : (
              <Table
                head={[
                  t('admin.common.circle'),
                  t('admin.circles.monthly'),
                  t('admin.common.status'),
                  t('admin.finance.organizingFees'),
                  t('admin.finance.bidRevenue'),
                  t('admin.finance.replacementFees'),
                  t('admin.finance.recoveryFees'),
                  t('admin.finance.revenueTotal'),
                  t('admin.finance.holdbacksApplied'),
                  t('admin.finance.recoveries'),
                  t('admin.overview.memberShortfall'),
                  t('admin.finance.toCharity'),
                ]}
              >
                {revenue.data.rows.map((r) => (
                  <tr key={r.circleId}>
                    <td className="mono">
                      <a href={`/circles/${r.circleId}`}>{shortId(r.circleId)}</a>
                    </td>
                    <td>
                      <Money m={r.monthly} lang={lang} />
                    </td>
                    <td>{t(`status.${r.status}`)}</td>
                    <td>
                      <Money m={r.organizingFees} lang={lang} />
                    </td>
                    <td>
                      <Money m={r.bidRevenue} lang={lang} />
                    </td>
                    <td>
                      <Money m={r.replacementFees} lang={lang} />
                    </td>
                    <td>
                      <Money m={r.recoveryFees} lang={lang} />
                    </td>
                    <td>
                      <strong>
                        <Money m={r.revenue} lang={lang} />
                      </strong>
                    </td>
                    <td>
                      <Money m={r.holdbacksApplied} lang={lang} />
                    </td>
                    <td>
                      <Money m={r.recoveries} lang={lang} />
                    </td>
                    <td>
                      <Money m={r.memberShortfall} lang={lang} />
                    </td>
                    <td>
                      <Money m={r.latePenaltiesToCharity} lang={lang} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Card>

      <Card title={t('admin.finance.ledger')}>
        <form className="form-row" action="/finance" style={{ marginBottom: 12 }}>
          <label>
            {t('admin.finance.type')}
            <select name="type" defaultValue={sp.type ?? ''}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {x || t('admin.common.all')}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('admin.finance.account')}
            <input
              name="account"
              defaultValue={sp.account ?? ''}
              dir="ltr"
              placeholder="platform_revenue"
            />
          </label>
          <label>
            {t('admin.common.circle')}
            <input name="circleId" defaultValue={sp.circleId ?? ''} dir="ltr" placeholder="uuid" />
          </label>
          <button className="btn secondary" type="submit">
            {t('admin.common.filter')}
          </button>
        </form>
        {!ledger.ok ? <LoadError r={ledger} t={tr} /> : <LedgerTable txns={ledger.data} t={tr} />}
      </Card>
    </div>
  );
}
