import type { AdminOverview } from '@sanad/api-client';
import { ActionForm, SubmitButton } from '../../components/ActionForm';
import { Card, LoadError, Money, PageHead, Stat } from '../../components/ui';
import { can } from '../../lib/nav';
import { getMe, getT, load } from '../../lib/server';
import { runTick } from './actions';

const ORDER = ['FORMING', 'AUCTION', 'DRAWING', 'ACTIVE', 'CLOSING', 'CLOSED', 'CANCELLED'];

export default async function OverviewPage() {
  const [tr, me, r] = await Promise.all([getT(), getMe(), load<AdminOverview>('/admin/overview')]);
  const { t, lang } = tr;
  if (!r.ok) return <LoadError r={r} t={tr} />;
  const o = r.data;
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.overview')} sub={t('admin.overview.modelNote')}>
        {can(me.roles, 'ops') ? (
          <ActionForm action={runTick} inline>
            <SubmitButton variant="secondary">{t('admin.overview.runTick')}</SubmitButton>
          </ActionForm>
        ) : null}
      </PageHead>

      <Card
        title={t('admin.overview.launch')}
        action={
          can(me.roles, 'legal', 'ops', 'viewer') ? (
            <a href="/content?tab=legal">{t('admin.overview.uploadNow')}</a>
          ) : null
        }
      >
        <div className="grid">
          <Stat
            tone={o.legal.lawyerApproved ? undefined : 'warn'}
            label={t('admin.overview.lawyerContract')}
            value={
              o.legal.lawyerApproved
                ? `✓ ${t('admin.overview.uploaded')}`
                : t('admin.overview.notUploaded')
            }
            sub={`v${o.legal.contractVersion}${o.legal.contractDocument ? ` · ${o.legal.contractDocument.title}` : ''}`}
          />
          <Stat
            tone={o.legal.shariah?.status.startsWith('APPROVED') ? undefined : 'warn'}
            label={t('admin.overview.shariahReview')}
            value={
              o.legal.shariah
                ? t(`admin.content.shariahStatuses.${o.legal.shariah.status}`)
                : t('admin.overview.notUploaded')
            }
            sub={o.legal.shariah?.reviewer ?? undefined}
          />
        </div>
      </Card>

      <div className="grid">
        <Stat
          tone="accent"
          label={t('admin.overview.revenue')}
          value={<Money m={o.revenue.total} lang={lang} />}
          sub={
            <>
              {t('admin.overview.organizingFees')}:{' '}
              <Money m={o.revenue.organizingFees} lang={lang} />
              {' · '}
              {t('admin.overview.bids')}: <Money m={o.revenue.bidRevenue} lang={lang} />
              {' · '}
              {t('admin.overview.otherFees')}: <Money m={o.revenue.otherFees} lang={lang} />
            </>
          }
        />
        <Stat label={t('admin.overview.feesHeld')} value={<Money m={o.feesHeld} lang={lang} />} />
        <Stat
          label={t('admin.overview.holdbacksHeld')}
          value={<Money m={o.holdbacksHeld} lang={lang} />}
        />
        <Stat
          tone={o.memberShortfall.fils !== '0' ? 'warn' : undefined}
          label={t('admin.overview.memberShortfall')}
          value={<Money m={o.memberShortfall} lang={lang} />}
          sub={
            <>
              {t('admin.overview.openClaims')}: <Money m={o.openClaims} lang={lang} />
            </>
          }
          href="/legal"
        />
        <Stat
          label={t('admin.overview.volume')}
          value={<Money m={o.monthlyVolume} lang={lang} />}
        />
        <Stat
          label={t('admin.overview.members')}
          value={<span className="num">{o.activeMembers}</span>}
          sub={`${t('admin.overview.membersInCircles')}: ${o.membersInCircles}`}
        />
        <Stat
          label={t('admin.overview.activeCircles')}
          value={<span className="num">{o.circles.ACTIVE ?? 0}</span>}
          href="/circles?status=ACTIVE"
        />
        <Stat
          tone={o.defaultsThisMonth > 0 ? 'warn' : undefined}
          label={t('admin.overview.defaults')}
          value={<span className="num">{o.defaultsThisMonth}</span>}
          href="/payments"
        />
        <Stat
          label={t('admin.overview.charity')}
          value={<Money m={o.charityPayable} lang={lang} />}
        />
      </div>

      <div className="two">
        <Card title={t('admin.overview.todo')}>
          <div className="grid">
            <Stat
              tone={o.kycPending ? 'warn' : undefined}
              label={t('admin.overview.kycPending')}
              value={<span className="num">{o.kycPending}</span>}
              href="/kyc"
            />
            <Stat
              tone={o.failedDisbursements ? 'bad' : undefined}
              label={t('admin.overview.failedDisbursements')}
              value={<span className="num">{o.failedDisbursements}</span>}
              href="/payments?failed=1"
            />
            <Stat
              tone={o.openLegalCases ? 'warn' : undefined}
              label={t('admin.overview.openCases')}
              value={<span className="num">{o.openLegalCases}</span>}
              href="/legal"
            />
          </div>
        </Card>
        <Card title={t('admin.overview.circlesByStatus')}>
          {ORDER.map((s) => {
            const n = o.circles[s] ?? 0;
            const max = Math.max(1, ...Object.values(o.circles));
            return (
              <a
                key={s}
                href={`/circles?status=${s}`}
                style={{ display: 'block', color: 'inherit', marginBottom: 10 }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{t(`status.${s}`)}</span>
                  <span className="num">{n}</span>
                </div>
                <div className="meter">
                  <span style={{ width: `${(n / max) * 100}%` }} />
                </div>
              </a>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
