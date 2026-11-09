'use server';
/**
 * Every dashboard mutation. Each calls the API with the signed-in admin's token; the API checks
 * the role and writes the audit log. Pages re-render with fresh data via revalidatePath.
 */
import { revalidatePath } from 'next/cache';
import { kwdToFils } from '../../lib/format';
import { AdminApiError, api, getT, mutate, mutateForm, type ActionResult } from '../../lib/server';

const str = (d: FormData, k: string) => String(d.get(k) ?? '').trim();
const confirmed = (d: FormData) => d.get('confirm') === 'on';

async function needConfirm(): Promise<ActionResult> {
  const { t } = await getT();
  return { ok: false, message: t('admin.common.confirmCheck') };
}

async function done(r: ActionResult, ...paths: string[]): Promise<ActionResult> {
  if (r?.ok) for (const p of paths) revalidatePath(p);
  return r;
}

// ── KYC ──
export async function approveKyc(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const id = str(d, 'id');
  return done(
    await mutate(`/admin/kyc/${id}/approve`, 'POST', {}, 'admin.kyc.decided'),
    '/kyc',
    `/kyc/${id}`,
  );
}
export async function rejectKyc(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const id = str(d, 'id');
  return done(
    await mutate(
      `/admin/kyc/${id}/reject`,
      'POST',
      { reason: str(d, 'reason') },
      'admin.kyc.decided',
    ),
    '/kyc',
    `/kyc/${id}`,
  );
}

// ── members ──
export async function banMember(_p: ActionResult, d: FormData): Promise<ActionResult> {
  if (!confirmed(d)) return needConfirm();
  const id = str(d, 'id');
  const action = str(d, 'action') === 'unban' ? 'unban' : 'ban';
  return done(
    await mutate(`/admin/members/${id}/${action}`, 'POST', { reason: str(d, 'reason') }),
    `/members/${id}`,
  );
}

// ── payments ──
export async function retryDisbursement(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const kind = str(d, 'kind') === 'refund' ? 'refund' : 'payout';
  return done(
    await mutate(
      `/admin/disbursements/${kind}/${str(d, 'id')}/retry`,
      'POST',
      undefined,
      'admin.payments.retried',
    ),
    '/payments',
  );
}

export async function runTick(_p: ActionResult): Promise<ActionResult> {
  return done(await mutate('/admin/jobs/tick', 'POST', undefined, 'admin.overview.tickDone'), '/');
}

// ── legal ──
export async function updateCase(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const id = str(d, 'id');
  const recoveredKwd = str(d, 'recovered');
  let recoveredFils: string | undefined;
  if (recoveredKwd) {
    const f = kwdToFils(recoveredKwd);
    if (f === null) {
      const { t } = await getT();
      return { ok: false, message: t('admin.common.error', { message: 'KWD 0.000' }) };
    }
    if (f !== '0') recoveredFils = f;
    if (recoveredFils && !confirmed(d)) return needConfirm();
  }
  const note = str(d, 'note');
  return done(
    await mutate(`/admin/legal/cases/${id}`, 'POST', {
      status: str(d, 'status'),
      ...(note ? { note } : {}),
      ...(recoveredFils ? { recoveredFils } : {}),
    }),
    '/legal',
    `/legal/${id}`,
  );
}

// ── finance ──
export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}
export type PreviewResult =
  | { ok: true; diff: DiffEntry[]; valid: boolean; issues: string[] }
  | { ok: false; message: string };

export async function previewConfig(json: string): Promise<PreviewResult> {
  const { t } = await getT();
  let config: unknown;
  try {
    config = JSON.parse(json);
  } catch {
    return { ok: false, message: t('admin.config.invalidJson') };
  }
  try {
    const r = await api<{ diff: DiffEntry[]; valid: boolean; issues: string[] }>(
      '/admin/config/preview',
      {
        method: 'POST',
        body: JSON.stringify({ config }),
      },
    );
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof AdminApiError)
      return { ok: false, message: t('admin.common.error', { message: e.message }) };
    throw e;
  }
}

export async function publishConfig(_p: ActionResult, d: FormData): Promise<ActionResult> {
  if (!confirmed(d)) return needConfirm();
  const { t } = await getT();
  let config: unknown;
  try {
    config = JSON.parse(str(d, 'config'));
  } catch {
    return { ok: false, message: t('admin.config.invalidJson') };
  }
  const notes = str(d, 'notes');
  return done(
    await mutate('/admin/config', 'POST', { config, ...(notes ? { notes } : {}) }),
    '/config',
  );
}

// ── content ──
export async function saveTemplate(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const key = str(d, 'key');
  const language = str(d, 'language') === 'en' ? 'en' : 'ar';
  return done(
    await mutate(`/admin/content/templates/${encodeURIComponent(key)}/${language}`, 'PUT', {
      title: str(d, 'title'),
      body: str(d, 'body'),
    }),
    '/content',
  );
}

export async function publishContract(_p: ActionResult, d: FormData): Promise<ActionResult> {
  if (!confirmed(d)) return needConfirm();
  return done(
    await mutate('/admin/content/contracts', 'POST', {
      titleAr: str(d, 'titleAr'),
      titleEn: str(d, 'titleEn'),
      bodyAr: str(d, 'bodyAr'),
      bodyEn: str(d, 'bodyEn'),
    }),
    '/content',
  );
}

export async function saveFaq(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const id = str(d, 'id');
  const body = {
    questionAr: str(d, 'questionAr'),
    answerAr: str(d, 'answerAr'),
    questionEn: str(d, 'questionEn'),
    answerEn: str(d, 'answerEn'),
    position: Number(str(d, 'position') || 0),
    published: d.get('published') === 'on',
  };
  return done(
    id
      ? await mutate(`/admin/content/faq/${id}`, 'PUT', body)
      : await mutate('/admin/content/faq', 'POST', body),
    '/content',
  );
}

export async function deleteFaq(_p: ActionResult, d: FormData): Promise<ActionResult> {
  return done(await mutate(`/admin/content/faq/${str(d, 'id')}`, 'DELETE'), '/content');
}

// ── support ──
export async function updateTicket(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const note = str(d, 'note');
  return done(
    await mutate(`/admin/support/${str(d, 'id')}`, 'POST', {
      status: str(d, 'status'),
      ...(note ? { note } : {}),
    }),
    '/support',
  );
}

// ── legal documents (lawyer's contract, Shariah review) ──
export async function uploadLegalDoc(_p: ActionResult, d: FormData): Promise<ActionResult> {
  const file = d.get('file');
  const { t } = await getT();
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: t('admin.content.file') };
  const form = new FormData();
  for (const k of [
    'kind',
    'title',
    'contractVersion',
    'reviewer',
    'reviewedOn',
    'status',
    'notes',
  ]) {
    const v = str(d, k);
    if (v) form.set(k, v);
  }
  if (str(d, 'kind') !== 'SHARIAH_REVIEW') {
    form.delete('status');
    form.delete('reviewer');
    form.delete('reviewedOn');
  } else form.delete('contractVersion');
  form.set('file', file, file.name);
  return done(await mutateForm('/admin/legal-docs', form), '/content', '/');
}
