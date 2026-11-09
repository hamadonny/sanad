import type { AdminLegalCase } from '@sanad/api-client';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '../../../../components/ActionForm';
import { Badge, Card, KV, LoadError, Money, PageHead } from '../../../../components/ui';
import { formatDateTime, shortId } from '../../../../lib/format';
import { can } from '../../../../lib/nav';
import { getMe, getT, load } from '../../../../lib/server';
import { updateCase } from '../../actions';

const STATUSES = ['OPEN', 'SENT_TO_LAWYER', 'FILED', 'JUDGMENT', 'RECOVERING', 'CLOSED'];

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const r = await load<AdminLegalCase[]>('/admin/legal/cases');
  if (!r.ok) return <LoadError r={r} t={tr} />;
  const c = r.data.find((x) => x.id === id);
  if (!c)
    return (
      <LoadError
        r={{ ok: false, status: 404, code: 'NOT_FOUND', message: 'case not found' }}
        t={tr}
      />
    );
  return (
    <div className="stack">
      <PageHead title={`${t('admin.legal.cases')} · ${c.name ?? shortId(c.userId)}`}>
        <Badge value={c.status} t={tr} scope="admin.legal.statuses" />
        {can(me.roles, 'legal') ? (
          <>
            <Link className="btn secondary" href={`/legal/${c.id}/file`}>
              {t('admin.legal.caseFile')}
            </Link>
            <a className="btn secondary" href={`/files/case/${c.id}/pdf`}>
              {t('admin.legal.downloadPdf')}
            </a>
            <a className="btn" href={`/files/case/${c.id}/zip`} title={t('admin.legal.zipHint')}>
              {t('admin.legal.downloadZip')}
            </a>
          </>
        ) : null}
      </PageHead>
      <div className="grid">
        <div className="stat">
          <div className="label">{t('admin.legal.gross')}</div>
          <div className="value">
            <Money m={c.grossOwed} lang={lang} />
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.legal.holdbackApplied')}</div>
          <div className="value">
            <Money m={c.holdbackApplied} lang={lang} />
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.legal.net')}</div>
          <div className="value">
            <Money m={c.netClaim} lang={lang} />
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('admin.legal.recovered')}</div>
          <div className="value">
            <Money m={c.recovered} lang={lang} />
          </div>
        </div>
        <div className="stat warn">
          <div className="label">{t('admin.legal.outstanding')}</div>
          <div className="value">
            <Money m={c.outstanding} lang={lang} />
          </div>
        </div>
      </div>
      <div className="two">
        <Card title={t('admin.members.profile')}>
          <KV
            items={[
              [
                t('admin.common.member'),
                <Link key="m" href={`/members/${c.userId}`}>
                  {c.name ?? c.userId}
                </Link>,
              ],
              [
                t('admin.common.circle'),
                <Link key="c" className="mono" href={`/circles/${c.circleId}`}>
                  {shortId(c.circleId)}
                </Link>,
              ],
              [t('admin.common.createdAt'), formatDateTime(c.createdAt, lang)],
              [t('admin.common.date'), formatDateTime(c.updatedAt, lang)],
            ]}
          />
        </Card>
        {can(me.roles, 'legal') ? (
          <Card title={t('admin.legal.update')}>
            <ActionForm action={updateCase}>
              <input type="hidden" name="id" value={c.id} />
              <label>
                {t('admin.common.status')}
                <select name="status" defaultValue={c.status}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`admin.legal.statuses.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('admin.legal.recoveredNow')}
                <input name="recovered" inputMode="decimal" placeholder="0.000" dir="ltr" />
              </label>
              <label>
                {t('admin.common.note')}
                <textarea name="note" maxLength={1000} />
              </label>
              <label className="check">
                <input type="checkbox" name="confirm" /> {t('admin.common.confirmCheck')}
              </label>
              <div>
                <SubmitButton>{t('admin.common.save')}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
