import type { AdminKycDetail } from '@sanad/api-client';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '../../../../components/ActionForm';
import { Badge, Card, KV, LoadError, PageHead } from '../../../../components/ui';
import { formatDate, formatDateTime } from '../../../../lib/format';
import { can } from '../../../../lib/nav';
import { getMe, getT, load } from '../../../../lib/server';
import { approveKyc, rejectKyc } from '../../actions';

export default async function KycDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const r = await load<AdminKycDetail>(`/admin/kyc/${id}`);
  if (!r.ok) return <LoadError r={r} t={tr} />;
  const k = r.data;
  const pending = k.status === 'PENDING_REVIEW';
  return (
    <div className="stack">
      <PageHead title={k.fullNameAr} sub={k.fullNameEn}>
        <Badge value={k.status} t={tr} />
        <Link href={`/members/${k.userId}`}>{t('admin.members.profile')}</Link>
      </PageHead>
      <div className="banner small">{t('admin.kyc.auditNotice')}</div>
      <div className="two">
        <Card title={t('admin.nav.kyc')}>
          <KV
            items={[
              [
                t('admin.kyc.civilId'),
                <span className="mono" key="c">
                  {k.civilIdNumber}
                </span>,
              ],
              [t('admin.kyc.nationality'), k.nationality],
              [t('admin.kyc.dob'), formatDate(k.dateOfBirth, lang)],
              [t('admin.kyc.expiry'), formatDate(k.civilIdExpiry, lang)],
              [t('admin.kyc.address'), k.address],
              [t('admin.kyc.employer'), k.employer ?? '—'],
              [t('admin.kyc.income'), k.incomeBand ?? '—'],
              [t('admin.kyc.submitted'), formatDateTime(k.createdAt, lang)],
              [t('admin.common.note'), k.reviewNote ?? '—'],
            ]}
          />
        </Card>
        {pending && can(me.roles, 'kyc_reviewer') ? (
          <Card title={t('admin.common.actions')}>
            <div className="stack">
              <ActionForm action={approveKyc} inline>
                <input type="hidden" name="id" value={k.id} />
                <SubmitButton>{t('admin.kyc.approve')}</SubmitButton>
              </ActionForm>
              <ActionForm action={rejectKyc}>
                <input type="hidden" name="id" value={k.id} />
                <label>
                  {t('admin.kyc.rejectReason')}
                  <textarea name="reason" required minLength={3} maxLength={500} />
                </label>
                <div>
                  <SubmitButton variant="danger">{t('admin.kyc.reject')}</SubmitButton>
                </div>
              </ActionForm>
            </div>
          </Card>
        ) : null}
      </div>
      <Card title={t('admin.kyc.documents')}>
        <div className="docs">
          {(['front', 'back', 'selfie'] as const).map((w) =>
            (w === 'front' ? k.frontDocKey : w === 'back' ? k.backDocKey : k.selfieKey) ? (
              <figure key={w}>
                <img src={`/files/kyc/${k.id}/${w}`} alt={t(`admin.kyc.${w}`)} />
                <figcaption className="muted small">{t(`admin.kyc.${w}`)}</figcaption>
              </figure>
            ) : null,
          )}
        </div>
      </Card>
    </div>
  );
}
