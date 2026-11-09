import type {
  AdminContract,
  AdminTemplate,
  FaqItem,
  LegalDocument,
  LegalStatus,
} from '@sanad/api-client';
import { ActionForm, SubmitButton } from '../../../components/ActionForm';
import { Card, Empty, LoadError, PageHead, Table, Tabs } from '../../../components/ui';
import type { Translator } from '../../../lib/i18n';
import { formatDateTime } from '../../../lib/format';
import { can } from '../../../lib/nav';
import { getMe, getT, load } from '../../../lib/server';
import { deleteFaq, publishContract, saveFaq, saveTemplate, uploadLegalDoc } from '../actions';
import { LegalUploadForm } from './LegalUploadForm';

function Templates({
  items,
  tr,
  editable,
}: {
  items: AdminTemplate[];
  tr: Translator;
  editable: boolean;
}) {
  const { t } = tr;
  return (
    <div className="stack">
      {items.map((tpl) => (
        <Card
          key={tpl.key}
          title={<span className="mono">{tpl.key}</span>}
          action={
            <span className="row small muted">
              {t('admin.content.channels')}: {tpl.channels.join(', ')}{' '}
              {tpl.customized ? (
                <span className="badge warn">{t('admin.content.customized')}</span>
              ) : null}
            </span>
          }
        >
          {tpl.placeholders.length ? (
            <p className="small muted" style={{ marginTop: 0 }}>
              {t('admin.content.placeholders')}:{' '}
              {tpl.placeholders.map((p) => (
                <code key={p} className="mono">
                  {`{{${p}}}`}{' '}
                </code>
              ))}
            </p>
          ) : null}
          <div className="two">
            {(['ar', 'en'] as const).map((lng) => (
              <ActionForm key={lng} action={saveTemplate}>
                <input type="hidden" name="key" value={tpl.key} />
                <input type="hidden" name="language" value={lng} />
                <strong>
                  {lng === 'ar' ? t('admin.content.arabic') : t('admin.content.english')}
                </strong>
                <label>
                  {t('admin.content.titleField')}
                  <input
                    name="title"
                    defaultValue={tpl[lng].title}
                    dir={lng === 'ar' ? 'rtl' : 'ltr'}
                    readOnly={!editable}
                    maxLength={120}
                    required
                  />
                </label>
                <label>
                  {t('admin.content.bodyField')}
                  <textarea
                    name="body"
                    defaultValue={tpl[lng].body}
                    dir={lng === 'ar' ? 'rtl' : 'ltr'}
                    readOnly={!editable}
                    maxLength={1000}
                    required
                  />
                </label>
                {editable ? (
                  <div>
                    <SubmitButton small>{t('admin.common.save')}</SubmitButton>
                  </div>
                ) : null}
              </ActionForm>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Contracts({
  items,
  tr,
  editable,
}: {
  items: AdminContract[];
  tr: Translator;
  editable: boolean;
}) {
  const { t, lang } = tr;
  const latest = items[0];
  return (
    <div className="stack">
      <Card title={t('admin.content.contracts')}>
        {items.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              'v',
              t('admin.content.titleField'),
              t('admin.common.date'),
              t('admin.content.signatures'),
              t('admin.legal.hash'),
            ]}
          >
            {items.map((c) => (
              <tr key={c.version}>
                <td className="num">{c.version}</td>
                <td>
                  <details>
                    <summary>{lang === 'ar' ? c.titleAr : c.titleEn}</summary>
                    <div className="two" style={{ marginTop: 8 }}>
                      <div dir="rtl" className="small" style={{ whiteSpace: 'pre-wrap' }}>
                        {c.bodyAr}
                      </div>
                      <div dir="ltr" className="small" style={{ whiteSpace: 'pre-wrap' }}>
                        {c.bodyEn}
                      </div>
                    </div>
                  </details>
                </td>
                <td className="small">{formatDateTime(c.publishedAt, lang)}</td>
                <td className="num">{c.signatures}</td>
                <td className="mono">{c.sha256.slice(0, 16)}…</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editable ? (
        <Card title={t('admin.content.newContract')}>
          <div className="banner warn small" style={{ marginBottom: 12 }}>
            {t('admin.content.contractWarning')}
          </div>
          <ActionForm action={publishContract}>
            <div className="two">
              <label>
                {t('admin.content.titleField')} — {t('admin.content.arabic')}
                <input
                  name="titleAr"
                  dir="rtl"
                  required
                  minLength={3}
                  defaultValue={latest?.titleAr}
                />
              </label>
              <label>
                {t('admin.content.titleField')} — {t('admin.content.english')}
                <input
                  name="titleEn"
                  dir="ltr"
                  required
                  minLength={3}
                  defaultValue={latest?.titleEn}
                />
              </label>
              <label>
                {t('admin.content.bodyField')} — {t('admin.content.arabic')}
                <textarea
                  name="bodyAr"
                  dir="rtl"
                  required
                  minLength={20}
                  rows={10}
                  defaultValue={latest?.bodyAr}
                />
              </label>
              <label>
                {t('admin.content.bodyField')} — {t('admin.content.english')}
                <textarea
                  name="bodyEn"
                  dir="ltr"
                  required
                  minLength={20}
                  rows={10}
                  defaultValue={latest?.bodyEn}
                />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" name="confirm" /> {t('admin.common.confirmCheck')}
            </label>
            <div>
              <SubmitButton>{t('admin.content.newContract')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}

function FaqForm({ item, tr }: { item?: FaqItem; tr: Translator }) {
  const { t } = tr;
  return (
    <ActionForm action={saveFaq} resetOnSuccess={!item}>
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <div className="two">
        <label>
          {t('admin.content.question')} — {t('admin.content.arabic')}
          <input
            name="questionAr"
            dir="rtl"
            required
            minLength={3}
            defaultValue={item?.questionAr}
          />
        </label>
        <label>
          {t('admin.content.question')} — {t('admin.content.english')}
          <input
            name="questionEn"
            dir="ltr"
            required
            minLength={3}
            defaultValue={item?.questionEn}
          />
        </label>
        <label>
          {t('admin.content.answer')} — {t('admin.content.arabic')}
          <textarea
            name="answerAr"
            dir="rtl"
            required
            minLength={3}
            defaultValue={item?.answerAr}
          />
        </label>
        <label>
          {t('admin.content.answer')} — {t('admin.content.english')}
          <textarea
            name="answerEn"
            dir="ltr"
            required
            minLength={3}
            defaultValue={item?.answerEn}
          />
        </label>
      </div>
      <div className="form-row">
        <label style={{ flex: '0 1 120px' }}>
          {t('admin.content.position')}
          <input
            name="position"
            type="number"
            min={0}
            max={1000}
            defaultValue={item?.position ?? 0}
          />
        </label>
        <label className="check">
          <input type="checkbox" name="published" defaultChecked={item?.published ?? true} />{' '}
          {t('admin.content.published')}
        </label>
        <SubmitButton small>
          {item ? t('admin.common.save') : t('admin.content.addFaq')}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

function Faq({ items, tr, editable }: { items: FaqItem[]; tr: Translator; editable: boolean }) {
  const { t, lang } = tr;
  return (
    <div className="stack">
      {items.map((f) => (
        <Card
          key={f.id}
          title={`${f.position}. ${lang === 'ar' ? f.questionAr : f.questionEn}`}
          action={
            f.published ? (
              <span className="badge good">{t('admin.content.published')}</span>
            ) : (
              <span className="badge">—</span>
            )
          }
        >
          {editable ? (
            <>
              <FaqForm item={f} tr={tr} />
              <ActionForm action={deleteFaq} inline className="form-row no-print">
                <input type="hidden" name="id" value={f.id} />
                <SubmitButton small variant="danger">
                  {t('admin.content.delete')}
                </SubmitButton>
              </ActionForm>
            </>
          ) : (
            <p>{lang === 'ar' ? f.answerAr : f.answerEn}</p>
          )}
        </Card>
      ))}
      {editable ? (
        <Card title={t('admin.content.addFaq')}>
          <FaqForm tr={tr} />
        </Card>
      ) : null}
    </div>
  );
}

function LegalDocs({
  data,
  tr,
  editable,
}: {
  data: { status: LegalStatus; documents: LegalDocument[] };
  tr: Translator;
  editable: boolean;
}) {
  const { t, lang } = tr;
  const { status } = data;
  return (
    <div className="stack">
      <div className="banner small">{t('admin.content.legalIntro')}</div>
      {!status.lawyerApproved ? (
        <div className="banner warn small">{t('admin.content.placeholderNow')}</div>
      ) : null}
      <div className="grid">
        <div className={`stat ${status.lawyerApproved ? '' : 'warn'}`}>
          <div className="label">{t('admin.overview.lawyerContract')}</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {status.lawyerApproved
              ? `✓ ${t('admin.overview.uploaded')}`
              : t('admin.overview.notUploaded')}
          </div>
          <div className="sub">v{status.contractVersion}</div>
        </div>
        <div className={`stat ${status.shariah?.status.startsWith('APPROVED') ? '' : 'warn'}`}>
          <div className="label">{t('admin.overview.shariahReview')}</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {status.shariah
              ? t(`admin.content.shariahStatuses.${status.shariah.status}`)
              : t('admin.overview.notUploaded')}
          </div>
          <div className="sub">{status.shariah?.reviewer ?? ''}</div>
        </div>
      </div>
      {editable ? (
        <Card title={t('admin.content.upload')}>
          <LegalUploadForm
            action={uploadLegalDoc}
            currentVersion={status.contractVersion}
            labels={{
              kind: t('admin.content.docKind'),
              kindContract: t('admin.content.kindContract'),
              kindShariah: t('admin.content.kindShariah'),
              title: t('admin.content.docTitle'),
              forVersion: t('admin.content.forVersion'),
              reviewer: t('admin.content.reviewer'),
              reviewedOn: t('admin.content.reviewedOn'),
              status: t('admin.content.shariahStatus'),
              notes: t('admin.common.note'),
              file: t('admin.content.file'),
              upload: t('admin.content.upload'),
              statuses: {
                PENDING: t('admin.content.shariahStatuses.PENDING'),
                APPROVED: t('admin.content.shariahStatuses.APPROVED'),
                APPROVED_WITH_CONDITIONS: t(
                  'admin.content.shariahStatuses.APPROVED_WITH_CONDITIONS',
                ),
                REJECTED: t('admin.content.shariahStatuses.REJECTED'),
              },
            }}
          />
        </Card>
      ) : null}
      <Card title={t('admin.content.uploadedDocs')}>
        {data.documents.length === 0 ? (
          <Empty t={tr} />
        ) : (
          <Table
            head={[
              t('admin.content.docKind'),
              t('admin.content.docTitle'),
              t('admin.common.status'),
              t('admin.content.reviewer'),
              t('admin.common.date'),
              t('admin.content.size'),
              '',
            ]}
          >
            {data.documents.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.kind === 'SHARIAH_REVIEW'
                    ? t('admin.content.kindShariah')
                    : `${t('admin.content.kindContract')} (v${d.contractVersion ?? '—'})`}
                </td>
                <td>
                  {d.title}
                  {d.notes ? <div className="muted small">{d.notes}</div> : null}
                </td>
                <td>
                  <span
                    className={`badge ${d.status.startsWith('APPROVED') || d.status === 'UPLOADED' ? 'good' : d.status === 'REJECTED' ? 'bad' : 'warn'}`}
                  >
                    {t(`admin.content.shariahStatuses.${d.status}`)}
                  </span>
                </td>
                <td>
                  {d.reviewer ?? '—'}
                  {d.reviewedOn ? <div className="muted small">{d.reviewedOn}</div> : null}
                </td>
                <td className="small">{formatDateTime(d.createdAt, lang)}</td>
                <td>
                  <span className="num">{(d.sizeBytes / 1024).toFixed(0)} KB</span>
                </td>
                <td className="end">
                  <a href={`/files/legal-doc/${d.id}`}>{t('admin.members.download')}</a>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = 'templates' } = await searchParams;
  const [tr, me] = await Promise.all([getT(), getMe()]);
  const { t } = tr;
  const tabs = (
    <Tabs
      items={[
        {
          href: '/content?tab=templates',
          label: t('admin.content.templates'),
          active: tab === 'templates',
        },
        {
          href: '/content?tab=contracts',
          label: t('admin.content.contracts'),
          active: tab === 'contracts',
        },
        { href: '/content?tab=faq', label: t('admin.content.faq'), active: tab === 'faq' },
        {
          href: '/content?tab=legal',
          label: t('admin.content.legalDocs'),
          active: tab === 'legal',
        },
      ]}
    />
  );
  let body;
  if (tab === 'legal') {
    const r = await load<{ status: LegalStatus; documents: LegalDocument[] }>('/admin/legal-docs');
    body = r.ok ? (
      <LegalDocs data={r.data} tr={tr} editable={can(me.roles, 'legal')} />
    ) : (
      <LoadError r={r} t={tr} />
    );
  } else if (tab === 'contracts') {
    const r = await load<AdminContract[]>('/admin/content/contracts');
    body = r.ok ? (
      <Contracts items={r.data} tr={tr} editable={can(me.roles, 'legal')} />
    ) : (
      <LoadError r={r} t={tr} />
    );
  } else if (tab === 'faq') {
    const r = await load<FaqItem[]>('/admin/content/faq');
    body = r.ok ? (
      <Faq items={r.data} tr={tr} editable={can(me.roles, 'ops')} />
    ) : (
      <LoadError r={r} t={tr} />
    );
  } else {
    const r = await load<AdminTemplate[]>('/admin/content/templates');
    body = r.ok ? (
      <Templates items={r.data} tr={tr} editable={can(me.roles, 'ops')} />
    ) : (
      <LoadError r={r} t={tr} />
    );
  }
  return (
    <div className="stack">
      <PageHead title={t('admin.nav.content')} />
      {tabs}
      {body}
    </div>
  );
}
