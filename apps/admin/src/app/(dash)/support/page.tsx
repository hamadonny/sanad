import type { AdminTicket } from '@sanad/api-client';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '../../../components/ActionForm';
import { Badge, Card, Empty, LoadError, PageHead, Tabs } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { can } from '../../../lib/nav';
import { getMe, getT, load } from '../../../lib/server';
import { updateTicket } from '../actions';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'];

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = 'OPEN' } = await searchParams;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t, lang } = tr;
  const r = await load<AdminTicket[]>(`/admin/support${status ? `?status=${status}` : ''}`);
  const editable = can(me.roles, 'ops');
  return (
    <div className="stack">
      <PageHead title={t('admin.support.tickets')} />
      <Tabs
        items={[
          ...STATUSES.map((s) => ({
            href: `/support?status=${s}`,
            label: t(`admin.support.statuses.${s}`),
            active: status === s,
          })),
          { href: '/support?status=', label: t('admin.common.all'), active: status === '' },
        ]}
      />
      {!r.ok ? (
        <LoadError r={r} t={tr} />
      ) : r.data.length === 0 ? (
        <Card>
          <Empty t={tr} />
        </Card>
      ) : (
        r.data.map((tk) => (
          <Card
            key={tk.id}
            title={tk.subject}
            action={
              <span className="row">
                <Badge value={tk.status} t={tr} scope="admin.support.statuses" />
                <span className="muted small">{formatDateTime(tk.createdAt, lang)}</span>
              </span>
            }
          >
            <p className="small muted" style={{ marginTop: 0 }}>
              <Link href={`/members/${tk.userId}`}>{tk.name ?? tk.userId}</Link>
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{tk.body}</p>
            {editable ? (
              <ActionForm action={updateTicket} inline>
                <input type="hidden" name="id" value={tk.id} />
                <label style={{ flex: '0 1 180px' }}>
                  {t('admin.common.status')}
                  <select name="status" defaultValue={tk.status}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`admin.support.statuses.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('admin.common.note')}
                  <input name="note" defaultValue={tk.adminNote ?? ''} maxLength={2000} />
                </label>
                <SubmitButton small>{t('admin.support.update')}</SubmitButton>
              </ActionForm>
            ) : tk.adminNote ? (
              <p className="muted small">↳ {tk.adminNote}</p>
            ) : null}
          </Card>
        ))
      )}
    </div>
  );
}
