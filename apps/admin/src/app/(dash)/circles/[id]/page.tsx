import type { AdminCircleDetail } from '@sanad/api-client';
import Link from 'next/link';
import { LedgerTable } from '../../../../components/LedgerTable';
import {
  Badge,
  Card,
  Empty,
  KV,
  LoadError,
  Money,
  PageHead,
  Table,
} from '../../../../components/ui';
import { formatDate, formatDateTime, shortId } from '../../../../lib/format';
import { getT, load } from '../../../../lib/server';

const STAT_KEYS: [string, string][] = [
  ['organizingFees', 'admin.finance.organizingFees'],
  ['bidRevenue', 'admin.finance.bidRevenue'],
  ['replacementFees', 'admin.finance.replacementFees'],
  ['recoveryFees', 'admin.finance.recoveryFees'],
  ['topUps', 'admin.finance.topUps'],
  ['holdbacksApplied', 'admin.finance.holdbacksApplied'],
  ['holdbacksReleased', 'admin.finance.holdbacksReleased'],
  ['recoveries', 'admin.finance.recoveries'],
  ['refundsDue', 'admin.finance.refundsDue'],
  ['catchUp', 'admin.finance.catchUp'],
  ['latePenalties', 'admin.finance.toCharity'],
  ['defaulterPenaltiesToCharity', 'admin.finance.defaulterPenalties'],
];

export default async function CirclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await getT();
  const { t, lang } = tr;
  const r = await load<AdminCircleDetail>(`/admin/circles/${id}`);
  if (!r.ok) return <LoadError r={r} t={tr} />;
  const c = r.data;
  const label = (k: string) => (k.startsWith('admin.') ? t(k) : k);
  return (
    <div className="stack">
      <PageHead
        title={`${t('admin.common.circle')} ${shortId(c.id)}`}
        sub={<span className="mono">{c.id}</span>}
      >
        <Badge value={c.status} t={tr} />
      </PageHead>
      <div className="grid">
        <div className="stat">
          <div className="label">{t('admin.circles.monthly')}</div>
          <div className="value">
            <Money m={c.monthly} lang={lang} />
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.circles.pot')}</div>
          <div className="value">
            <Money m={c.pot} lang={lang} />
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.circles.filled')}</div>
          <div className="value num">
            {c.roster.filter((m) => m.status !== 'LEFT').length} / {c.members}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.circles.start')}</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {formatDate(c.startDate, lang)}
          </div>
          <div className="sub">
            {t('admin.circles.configVersion')}: {c.configVersion}
          </div>
        </div>
      </div>

      <Card title={t('admin.circles.roster')}>
        {c.roster.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.spot'),
              t('admin.common.member'),
              t('admin.common.status'),
              t('admin.circles.tier'),
              t('admin.circles.holdback'),
              t('admin.circles.bid'),
              t('admin.circles.received'),
            ]}
          >
            {c.roster.map((m) => (
              <tr key={m.userId}>
                <td className="num">
                  {m.spot ?? '—'}
                  {m.originalSpot && m.originalSpot !== m.spot ? ` (${m.originalSpot})` : ''}
                </td>
                <td>
                  <Link href={`/members/${m.userId}`}>{m.name}</Link>
                  {m.isReplacement ? (
                    <>
                      {' '}
                      <span className="badge">{t('admin.circles.replacement')}</span>
                    </>
                  ) : null}
                </td>
                <td>
                  <Badge value={m.status} t={tr} />
                </td>
                <td className="num">{m.tierAtJoin}</td>
                <td className="num">{m.holdbackPct}%</td>
                <td>
                  <Money m={m.bid} lang={lang} />
                </td>
                <td>{m.receivedPayout ? '✓' : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="two">
        <Card title={t('admin.circles.schedule')}>
          {c.schedule.length === 0 ? (
            <Empty t={tr} />
          ) : (
            <Table
              head={[
                t('admin.common.month'),
                t('admin.circles.due'),
                t('admin.circles.payout'),
                t('admin.circles.recipient'),
                t('admin.common.status'),
              ]}
            >
              {c.schedule.map((s) => (
                <tr key={s.month}>
                  <td className="num">{s.month}</td>
                  <td>{formatDate(s.dueDate, lang)}</td>
                  <td>{formatDate(s.payoutDate, lang)}</td>
                  <td>
                    {s.recipientName ?? '—'}{' '}
                    <span className="muted small">
                      ({t('common.spot', { n: s.recipientSpot })})
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${s.unpaid === 0 ? 'good' : ''}`}>
                      {t('admin.circles.paidOf', { paid: s.paid, total: s.total })}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={t('admin.circles.draw')}>
          {c.draw ? (
            <KV
              items={[
                [
                  t('admin.circles.commitment'),
                  <span className="mono" key="c">
                    {c.draw.commitment}
                  </span>,
                ],
                [
                  t('admin.circles.seed'),
                  <span className="mono" key="s">
                    {c.draw.revealedSeed}
                  </span>,
                ],
                [t('admin.circles.algorithm'), c.draw.algorithmVersion],
                [t('admin.common.date'), formatDateTime(c.draw.drawnAt, lang)],
              ]}
            />
          ) : (
            <>
              <p className="muted">{t('admin.circles.drawPending')}</p>
              {c.commitment ? (
                <KV
                  items={[
                    [
                      t('admin.circles.commitment'),
                      <span className="mono" key="c">
                        {c.commitment}
                      </span>,
                    ],
                  ]}
                />
              ) : null}
            </>
          )}
          <h3 style={{ marginTop: 18, marginBottom: 8 }}>{t('admin.circles.stats')}</h3>
          <KV
            items={STAT_KEYS.filter(([k]) => c.stats[k]).map(([k, l]) => [
              label(l),
              <Money key={k} m={c.stats[k]} lang={lang} />,
            ])}
          />
        </Card>
      </div>

      <Card title={t('admin.circles.bids')}>
        {c.bids.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              '#',
              t('admin.common.spot'),
              t('admin.common.member'),
              t('admin.common.amount'),
              t('admin.circles.active'),
              t('admin.common.date'),
            ]}
          >
            {c.bids.map((b) => (
              <tr key={b.seq}>
                <td className="num">{b.seq}</td>
                <td className="num">{b.spot}</td>
                <td>{b.name}</td>
                <td>
                  <Money m={b.amount} lang={lang} />
                </td>
                <td>{b.active ? '✓' : '—'}</td>
                <td>{formatDateTime(b.placedAt, lang)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={`${t('admin.circles.ledger')} (${c.ledger.length})`}>
        <details>
          <summary>{t('admin.common.view')}</summary>
          <LedgerTable txns={c.ledger} t={tr} />
        </details>
      </Card>
    </div>
  );
}
