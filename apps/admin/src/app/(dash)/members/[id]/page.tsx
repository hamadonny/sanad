import type { AdminMemberDetail, SignatureView } from '@sanad/api-client';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '../../../../components/ActionForm';
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
import { can } from '../../../../lib/nav';
import { getMe, getT, load } from '../../../../lib/server';
import { banMember } from '../../actions';

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const r = await load<AdminMemberDetail>(`/admin/members/${id}`);
  if (!r.ok) return <LoadError r={r} t={tr} />;
  const sigs = can(me.roles, 'ops', 'legal')
    ? await load<SignatureView[]>(`/admin/members/${id}/signatures`)
    : null;
  const { user: u, trust, kyc } = r.data;
  const banned = u.status === 'BANNED';
  return (
    <div className="stack">
      <PageHead
        title={
          (lang === 'ar' ? u.fullNameAr : u.fullNameEn) ?? u.fullNameEn ?? u.fullNameAr ?? u.phone
        }
        sub={<span className="num">{u.phone}</span>}
      >
        <Badge value={u.status} t={tr} />
        <Badge value={u.kycStatus} t={tr} />
      </PageHead>
      {banned ? (
        <div className="banner bad">
          {t('admin.members.bannedBecause', { reason: u.bannedReason ?? '—' })}
        </div>
      ) : null}
      <div className="grid">
        <div className="stat">
          <div className="label">{t('admin.members.tier')}</div>
          <div className="value num">{r.data.tier ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.members.completed')}</div>
          <div className="value num">{trust.completedCircles}</div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.members.late')}</div>
          <div className="value num">{trust.latePayments}</div>
        </div>
        <div className={`stat ${trust.defaults ? 'bad' : ''}`}>
          <div className="label">{t('admin.members.defaults')}</div>
          <div className="value num">{trust.defaults}</div>
        </div>
        <div className={`stat ${r.data.amountOwed.fils !== '0' ? 'warn' : ''}`}>
          <div className="label">{t('admin.members.owed')}</div>
          <div className="value">
            <Money m={r.data.amountOwed} lang={lang} />
          </div>
        </div>
      </div>
      <div className="two">
        <Card title={t('admin.members.profile')}>
          <KV
            items={[
              [t('admin.common.name'), `${u.fullNameAr ?? '—'} · ${u.fullNameEn ?? '—'}`],
              [
                t('admin.common.phone'),
                <span className="num" key="p">
                  {u.phone}
                </span>,
              ],
              [t('admin.kyc.nationality'), kyc?.nationality ?? '—'],
              [t('admin.kyc.expiry'), formatDate(u.civilIdExpiry, lang)],
              [
                t('admin.members.kycStatus'),
                kyc ? (
                  <span key="k">
                    <Badge value={kyc.status} t={tr} />{' '}
                    {can(me.roles, 'kyc_reviewer') ? (
                      <Link href={`/kyc/${kyc.id}`}>{t('admin.common.open')}</Link>
                    ) : null}
                  </span>
                ) : (
                  '—'
                ),
              ],
              [t('admin.members.joined'), formatDateTime(u.createdAt, lang)],
            ]}
          />
        </Card>
        {can(me.roles, 'ops') ? (
          <Card title={banned ? t('admin.members.unban') : t('admin.members.ban')}>
            <ActionForm action={banMember}>
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="action" value={banned ? 'unban' : 'ban'} />
              <label>
                {banned ? t('admin.members.unbanReason') : t('admin.members.banReason')}
                <textarea name="reason" required minLength={3} maxLength={500} />
              </label>
              <label className="check">
                <input type="checkbox" name="confirm" /> {t('admin.common.confirmCheck')}
              </label>
              <div>
                <SubmitButton variant={banned ? 'secondary' : 'danger'}>
                  {banned ? t('admin.members.unban') : t('admin.members.ban')}
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
      {sigs?.ok ? (
        <Card title={t('admin.members.signed')}>
          {sigs.data.length === 0 ? (
            <Empty t={tr} />
          ) : (
            <Table
              head={[t('admin.common.name'), t('admin.common.date'), t('admin.legal.hash'), '']}
            >
              {sigs.data.map((sg) => (
                <tr key={sg.id}>
                  <td>
                    {sg.kind === 'MEMBERSHIP'
                      ? t('admin.members.contractV', { v: sg.contractVersion ?? '—' })
                      : t('admin.members.addendum', { id: shortId(sg.circleId) })}
                  </td>
                  <td className="small">{formatDateTime(sg.signedAt, lang)}</td>
                  <td className="mono">{sg.documentHash.slice(0, 16)}…</td>
                  <td className="end">
                    <a href={`/files/signature/${sg.id}`}>{t('admin.members.download')}</a>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
      <Card title={t('admin.members.memberships')}>
        {r.data.memberships.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.circle'),
              t('admin.circles.monthly'),
              t('admin.common.spot'),
              t('admin.common.status'),
              t('admin.circles.received'),
              t('admin.members.joined'),
            ]}
          >
            {r.data.memberships.map((m) => (
              <tr key={m.circleId}>
                <td>
                  <Link className="mono" href={`/circles/${m.circleId}`}>
                    {shortId(m.circleId)}
                  </Link>{' '}
                  <Badge value={m.circleStatus} t={tr} />
                </td>
                <td>
                  <Money m={m.monthly} lang={lang} />
                </td>
                <td className="num">{m.spot ?? '—'}</td>
                <td>
                  <Badge value={m.status} t={tr} />
                </td>
                <td>{m.receivedPayout ? '✓' : '—'}</td>
                <td>{formatDate(m.joinedAt, lang)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {r.data.unpaid.length ? (
        <Card title={t('admin.members.unpaid')}>
          <Table
            head={[
              t('admin.common.circle'),
              t('admin.common.month'),
              t('admin.circles.due'),
              t('admin.common.amount'),
            ]}
          >
            {r.data.unpaid.map((i) => (
              <tr key={`${i.circleId}-${i.month}`}>
                <td className="mono">
                  <Link href={`/circles/${i.circleId}`}>{shortId(i.circleId)}</Link>
                </td>
                <td className="num">{i.month}</td>
                <td>{formatDate(i.dueDate, lang)}</td>
                <td>
                  <Money m={i.amount} lang={lang} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
      <Card title={t('admin.members.payments')}>
        {r.data.payments.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.date'),
              t('admin.members.purpose'),
              t('admin.common.circle'),
              t('admin.common.month'),
              t('admin.common.amount'),
              t('admin.members.penalty'),
              t('admin.common.status'),
            ]}
          >
            {r.data.payments.map((p) => (
              <tr key={p.id}>
                <td className="small">{formatDateTime(p.createdAt, lang)}</td>
                <td>{p.purpose}</td>
                <td className="mono">{p.circleId ? shortId(p.circleId) : '—'}</td>
                <td className="num">{p.month ?? '—'}</td>
                <td>
                  <Money m={p.amount} lang={lang} />
                </td>
                <td>
                  <Money m={p.penalty} lang={lang} />
                </td>
                <td>
                  <Badge value={p.status} t={tr} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t('admin.members.tickets')}>
        {r.data.tickets.length === 0 ? (
          <Empty t={tr} />
        ) : (
          r.data.tickets.map((tk) => (
            <div key={tk.id} style={{ marginBottom: 12 }}>
              <div className="row">
                <strong>{tk.subject}</strong>{' '}
                <Badge value={tk.status} t={tr} scope="admin.support.statuses" />{' '}
                <span className="muted small">{formatDateTime(tk.createdAt, lang)}</span>
              </div>
              <div className="small">{tk.body}</div>
              {tk.adminNote ? <div className="muted small">↳ {tk.adminNote}</div> : null}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
