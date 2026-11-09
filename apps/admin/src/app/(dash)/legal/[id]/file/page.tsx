import type { AdminLegalCaseFile } from '@sanad/api-client';
import { PrintButton } from '../../../../../components/PrintButton';
import {
  Badge,
  Card,
  Empty,
  KV,
  LoadError,
  Money,
  PageHead,
  Table,
} from '../../../../../components/ui';
import { formatDate, formatDateTime } from '../../../../../lib/format';
import { getT, load } from '../../../../../lib/server';

/** Printable legal case file (spec §8). Reading it is audited by the API. */
export default async function CaseFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await getT();
  const { t, lang } = tr;
  const r = await load<AdminLegalCaseFile>(`/admin/legal/cases/${id}/file`);
  if (!r.ok) return <LoadError r={r} t={tr} />;
  const f = r.data;
  return (
    <div className="stack">
      <PageHead
        title={`${t('admin.legal.caseFile')} — ${f.member.fullNameAr ?? f.member.fullNameEn ?? ''}`}
        sub={t('admin.legal.generated', { date: formatDateTime(f.generatedAt, lang) })}
      >
        <PrintButton label={t('admin.common.print')} />
        <a className="btn secondary" href={`/files/case/${id}/pdf`}>
          {t('admin.legal.downloadPdf')}
        </a>
        <a className="btn" href={`/files/case/${id}/zip`}>
          {t('admin.legal.downloadZip')}
        </a>
      </PageHead>
      <div className="banner small no-print">
        {t('admin.legal.zipHint')} {t('admin.kyc.auditNotice')}
      </div>
      <div className="two">
        <Card title={t('admin.legal.identity')}>
          <KV
            items={[
              [
                t('admin.common.name'),
                `${f.member.fullNameAr ?? '—'} / ${f.member.fullNameEn ?? '—'}`,
              ],
              [
                t('admin.kyc.civilId'),
                <span className="mono" key="c">
                  {f.member.civilIdNumber ?? '—'}
                </span>,
              ],
              [t('admin.kyc.nationality'), f.member.nationality ?? '—'],
              [t('admin.kyc.dob'), formatDate(f.member.dateOfBirth, lang)],
              [t('admin.kyc.address'), f.member.address ?? '—'],
              [
                t('admin.common.phone'),
                <span className="num" key="p">
                  {f.member.phone}
                </span>,
              ],
            ]}
          />
        </Card>
        <Card title={t('admin.legal.cases')}>
          <KV
            items={[
              [
                t('admin.common.status'),
                <Badge key="s" value={f.case.status} t={tr} scope="admin.legal.statuses" />,
              ],
              [t('admin.legal.gross'), <Money key="g" m={f.case.grossOwed} lang={lang} />],
              [
                t('admin.legal.holdbackApplied'),
                <Money key="h" m={f.case.holdbackApplied} lang={lang} />,
              ],
              [t('admin.legal.net'), <Money key="n" m={f.case.netClaim} lang={lang} />],
              [t('admin.legal.recovered'), <Money key="r" m={f.case.recovered} lang={lang} />],
              [
                t('admin.legal.outstanding'),
                <strong key="o">
                  <Money m={f.case.outstanding} lang={lang} />
                </strong>,
              ],
              [
                t('admin.common.circle'),
                <span className="mono" key="c">
                  {f.circle.id}
                </span>,
              ],
              [t('admin.circles.monthly'), <Money key="m" m={f.circle.monthly} lang={lang} />],
              [t('admin.common.spot'), f.circle.spot ?? '—'],
            ]}
          />
        </Card>
      </div>
      <Card title={t('admin.legal.contract')}>
        {f.contract ? (
          <KV
            items={[
              [t('admin.legal.version'), f.contract.version],
              [
                t('admin.legal.hash'),
                <span className="mono" key="h">
                  {f.contract.documentHash}
                </span>,
              ],
              [t('admin.common.date'), formatDateTime(f.contract.signedAt, lang)],
              ['IP', f.contract.ip ?? '—'],
            ]}
          />
        ) : (
          <p className="muted">{t('admin.legal.noContract')}</p>
        )}
      </Card>
      <Card title={t('admin.legal.scheduleVsPaid')}>
        {f.schedule.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.month'),
              t('admin.circles.due'),
              t('admin.common.amount'),
              t('admin.common.status'),
              t('admin.common.date'),
            ]}
          >
            {f.schedule.map((s) => (
              <tr key={s.month}>
                <td className="num">{s.month}</td>
                <td>{formatDate(s.dueDate, lang)}</td>
                <td>
                  <Money m={s.amount} lang={lang} />
                </td>
                <td>
                  <Badge value={s.status} t={tr} />
                </td>
                <td>{formatDateTime(s.paidAt, lang)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t('admin.legal.payoutProof')}>
        {f.payouts.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.payments.kind'),
              t('admin.common.month'),
              t('admin.common.amount'),
              t('admin.common.status'),
              t('admin.common.date'),
              t('admin.legal.reference'),
            ]}
          >
            {f.payouts.map((p, i) => (
              <tr key={i}>
                <td>{p.kind}</td>
                <td className="num">{p.month ?? '—'}</td>
                <td>
                  <Money m={p.amount} lang={lang} />
                </td>
                <td>
                  <Badge value={p.status} t={tr} />
                </td>
                <td>{formatDateTime(p.sentAt, lang)}</td>
                <td className="mono">{p.providerRef ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t('admin.legal.reminders')}>
        {f.notifications.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.date'),
              t('admin.audit.action'),
              t('admin.content.channels'),
              t('admin.common.status'),
            ]}
          >
            {f.notifications.map((n, i) => (
              <tr key={i}>
                <td className="small">{formatDateTime(n.createdAt, lang)}</td>
                <td className="mono">{n.eventKey}</td>
                <td>{n.channels.join(', ')}</td>
                <td>
                  <Badge value={n.status} t={tr} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t('admin.legal.history')}>
        {f.events.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.common.date'),
              t('admin.common.status'),
              t('admin.legal.recovered'),
              t('admin.common.note'),
            ]}
          >
            {f.events.map((e, i) => (
              <tr key={i}>
                <td className="small">{formatDateTime(e.createdAt, lang)}</td>
                <td>
                  <Badge value={e.status} t={tr} scope="admin.legal.statuses" />
                </td>
                <td>{e.amount ? <Money m={e.amount} lang={lang} /> : '—'}</td>
                <td>{e.note ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
