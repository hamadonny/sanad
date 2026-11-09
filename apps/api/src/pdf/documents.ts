/**
 * Content of every generated document. Arabic first (primary, right-to-left), English
 * translation after. Money uses Latin digits with 3 decimals (spec §0.5).
 */
import type { AdminLegalCaseFile, ApiMoney } from '@sanad/api-client';
import type { PdfBlock, PdfDoc } from './pdf-doc.js';

const ar = (m: ApiMoney | string) => `${groupKwd(typeof m === 'string' ? m : m.kwd)} د.ك`;
const en = (m: ApiMoney | string) => `${groupKwd(typeof m === 'string' ? m : m.kwd)} KWD`;

export function groupKwd(kwd: string): string {
  const neg = kwd.startsWith('-');
  const [int = '0', dec = '000'] = (neg ? kwd.slice(1) : kwd).split('.');
  return `${neg ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

/** "2027-01-15 13:05" in Kuwait time. */
export function kuwaitDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const k = new Date(date.getTime() + 3 * 3600_000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)}`;
}

/** Shown on documents whose legal text is still the placeholder [LEGAL][SHARIAH]. */
export const PLACEHOLDER_NOTICE_AR =
  'تنبيه: نص العقد مؤقت إلى أن يُرفع العقد المعتمد من المحامي، والمراجعة الشرعية لم تُرفع بعد.';
export const PLACEHOLDER_NOTICE_EN =
  'Notice: the agreement text is a placeholder until the lawyer-approved contract is uploaded; the Shariah review has not been uploaded yet.';

export interface LegalStatusForDoc {
  /** Lawyer's final contract uploaded for this version. */
  lawyerApproved: boolean;
  shariah: { status: string; reviewer: string | null; reviewedOn: string | null } | null;
}

function legalNotice(s: LegalStatusForDoc): PdfBlock[] {
  const out: PdfBlock[] = [];
  if (!s.lawyerApproved || !s.shariah || s.shariah.status === 'PENDING') {
    out.push({ kind: 'banner', text: PLACEHOLDER_NOTICE_AR, dir: 'rtl' });
    out.push({ kind: 'banner', text: PLACEHOLDER_NOTICE_EN, dir: 'ltr' });
  }
  return out;
}

function shariahLine(s: LegalStatusForDoc): [string, string] {
  if (!s.shariah) return ['المراجعة الشرعية', 'لم تُرفع بعد / Not uploaded yet'];
  const label: Record<string, string> = {
    PENDING: 'قيد المراجعة / Pending',
    APPROVED: 'مُجاز / Approved',
    APPROVED_WITH_CONDITIONS: 'مُجاز بشروط / Approved with conditions',
    REJECTED: 'غير مُجاز / Not approved',
  };
  return [
    'المراجعة الشرعية',
    `${label[s.shariah.status] ?? s.shariah.status}${s.shariah.reviewer ? ` — ${s.shariah.reviewer}` : ''}${s.shariah.reviewedOn ? ` (${s.shariah.reviewedOn})` : ''}`,
  ];
}

// ── receipt ──

export interface ReceiptData {
  id: string;
  purpose: string;
  circleId: string | null;
  month: number | null;
  amount: ApiMoney;
  penalty: ApiMoney;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
  memberName: string;
  phoneMasked: string;
  providerRef: string | null;
}

const PURPOSE: Record<string, [string, string]> = {
  ORGANIZING_FEE: ['رسم التنظيم', 'Organising fee'],
  CONTRIBUTION: ['قسط شهري', 'Monthly contribution'],
  REPLACEMENT: ['انضمام بديل', 'Replacement joining'],
};

export function receiptDoc(r: ReceiptData): PdfDoc {
  const [pAr, pEn] = PURPOSE[r.purpose] ?? [r.purpose, r.purpose];
  const base = r.amount.fils;
  const contribution = (BigInt(base) - BigInt(r.penalty.fils)).toString();
  const kwd = (fils: string) => {
    const f = BigInt(fils);
    return `${f / 1000n}.${(f % 1000n).toString().padStart(3, '0')}`;
  };
  return {
    title: 'إيصال دفع — Payment receipt',
    reference: `#${r.id.slice(0, 8)}`,
    createdAt: r.paidAt ?? r.createdAt,
    dir: 'rtl',
    blocks: [
      { kind: 'title', text: 'إيصال دفع' },
      {
        kind: 'kv',
        rows: [
          ['رقم الإيصال', r.id],
          ['العضو', `${r.memberName} — ${r.phoneMasked}`],
          ['الغرض', pAr],
          ...(r.circleId ? ([['الجمعية', r.circleId.slice(0, 8)]] as [string, string][]) : []),
          ...(r.month ? ([['الشهر', String(r.month)]] as [string, string][]) : []),
          ['المبلغ', ar(kwd(contribution))],
          ...(r.penalty.fils !== '0'
            ? ([['غرامة تأخير (تُصرف للخير)', ar(r.penalty)]] as [string, string][])
            : []),
          ['الإجمالي المدفوع', ar(r.amount)],
          ['تاريخ الدفع', `${kuwaitDateTime(r.paidAt)} (توقيت الكويت)`],
          ['مرجع البوابة', r.providerRef ?? '—'],
        ],
      },
      { kind: 'divider' },
      { kind: 'heading', text: 'Payment receipt', dir: 'ltr' },
      {
        kind: 'kv',
        dir: 'ltr',
        rows: [
          ['Receipt', r.id],
          ['Purpose', pEn],
          ['Amount', en(kwd(contribution))],
          ...(r.penalty.fils !== '0'
            ? ([['Late penalty (to charity)', en(r.penalty)]] as [string, string][])
            : []),
          ['Total paid', en(r.amount)],
          ['Paid at (Kuwait time)', kuwaitDateTime(r.paidAt)],
        ],
      },
      {
        kind: 'paragraph',
        muted: true,
        size: 9,
        text: 'غرامات التأخير تذهب إلى جهة خيرية ولا تُعدّ دخلاً لسند. Late penalties go to charity and are never Sanad revenue.',
      },
    ],
  };
}

// ── signed membership contract ──

export interface ContractSignedData {
  version: number;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  textHash: string;
  signer: {
    name: string;
    nameEn: string | null;
    civilIdMasked: string | null;
    phoneMasked: string;
  };
  signedAt: Date;
  ip: string | null;
  device: string | null;
  otpReference: string | null;
  legal: LegalStatusForDoc;
}

export function contractDoc(c: ContractSignedData): PdfDoc {
  const sig: [string, string][] = [
    ['الموقّع', `${c.signer.name}${c.signer.nameEn ? ` / ${c.signer.nameEn}` : ''}`],
    ['الرقم المدني', c.signer.civilIdMasked ?? '—'],
    ['الهاتف', c.signer.phoneMasked],
    ['تاريخ التوقيع', `${kuwaitDateTime(c.signedAt)} (توقيت الكويت)`],
    ['طريقة التوقيع', 'رمز تحقق برسالة نصية (OTP) / SMS one-time code'],
    ['مرجع رمز التحقق', c.otpReference ?? '—'],
    ['عنوان IP', c.ip ?? '—'],
    ['الجهاز', c.device ?? '—'],
    ['نسخة العقد', String(c.version)],
    ['بصمة نص العقد (SHA-256)', c.textHash],
    shariahLine(c.legal),
  ];
  return {
    title: `عقد العضوية — الإصدار ${c.version}`,
    reference: `v${c.version} · ${c.textHash.slice(0, 16)}`,
    createdAt: c.signedAt,
    dir: 'rtl',
    watermark: c.legal.lawyerApproved
      ? undefined
      : 'نص مؤقت — Placeholder text pending legal review',
    blocks: [
      { kind: 'title', text: c.titleAr },
      ...legalNotice(c.legal),
      { kind: 'paragraph', text: c.bodyAr },
      { kind: 'heading', text: 'التوقيع الإلكتروني' },
      { kind: 'signature', rows: sig },
      { kind: 'pageBreak' },
      { kind: 'title', text: c.titleEn, dir: 'ltr' },
      {
        kind: 'paragraph',
        dir: 'ltr',
        muted: true,
        size: 9,
        text: 'English translation. The Arabic text prevails.',
      },
      { kind: 'paragraph', dir: 'ltr', text: c.bodyEn },
      { kind: 'heading', text: 'Electronic signature', dir: 'ltr' },
      {
        kind: 'signature',
        dir: 'ltr',
        rows: [
          ['Signed by', `${c.signer.nameEn ?? c.signer.name}`],
          ['Signed at (Kuwait time)', kuwaitDateTime(c.signedAt)],
          ['Method', 'SMS one-time code'],
          ['OTP reference', c.otpReference ?? '—'],
          ['Contract version', String(c.version)],
          ['Text hash (SHA-256)', c.textHash],
        ],
      },
    ],
  };
}

// ── addendum (after the draw) ──

export interface AddendumData {
  circleId: string;
  memberName: string;
  spot: number;
  months: number;
  monthly: ApiMoney;
  pot: ApiMoney;
  bid: ApiMoney;
  holdback: ApiMoney;
  holdbackPct: number;
  expectedPayout: ApiMoney;
  payoutDate: string;
  drawCommitment: string | null;
  schedule: {
    month: number;
    dueDate: string;
    payoutDate: string;
    amount: ApiMoney;
    recipientSpot: number;
  }[];
  documentHash: string;
  acknowledgedAt: Date | null;
  ip: string | null;
}

export function addendumDoc(a: AddendumData): PdfDoc {
  return {
    title: 'ملحق العقد — جدول الدفعات / Contract addendum — schedule',
    reference: `${a.circleId.slice(0, 8)} · ${a.documentHash.slice(0, 16)}`,
    createdAt: a.acknowledgedAt ?? new Date(`${a.schedule[0]?.dueDate ?? '2027-01-01'}T00:00:00Z`),
    dir: 'rtl',
    blocks: [
      { kind: 'title', text: 'ملحق عقد العضوية: دورك وجدول الدفعات' },
      {
        kind: 'kv',
        rows: [
          ['العضو', a.memberName],
          ['الجمعية', a.circleId],
          ['دورك', `${a.spot} من ${a.months}`],
          ['القسط الشهري', ar(a.monthly)],
          ['مبلغ الجمعية', ar(a.pot)],
          ...(a.bid.fils !== '0'
            ? ([['مزايدة الدور (تُخصم)', ar(a.bid)]] as [string, string][])
            : []),
          ...(a.holdback.fils !== '0'
            ? ([[`الاستقطاع (${a.holdbackPct}%)، يُعاد بعد إكمال الأقساط`, ar(a.holdback)]] as [
                string,
                string,
              ][])
            : []),
          ['ستستلم', ar(a.expectedPayout)],
          ['تاريخ الاستلام', a.payoutDate],
          ['التزام القرعة', a.drawCommitment ?? '—'],
        ],
      },
      {
        kind: 'paragraph',
        text: 'تلتزم بدفع القسط الشهري كاملًا في موعده حتى نهاية الجمعية، بما في ذلك شهر استلامك والأشهر التي بعده.',
      },
      {
        kind: 'table',
        columns: [
          { label: 'الشهر', width: 1 },
          { label: 'الاستحقاق', width: 2 },
          { label: 'القسط', width: 2 },
          { label: 'الاستلام', width: 2 },
          { label: 'دور المستلم', width: 1.4 },
        ],
        rows: a.schedule.map((s) => [
          String(s.month),
          s.dueDate,
          ar(s.amount),
          s.payoutDate,
          s.recipientSpot === a.spot ? `${s.recipientSpot} (أنت)` : String(s.recipientSpot),
        ]),
      },
      {
        kind: 'signature',
        rows: [
          [
            'الإقرار',
            a.acknowledgedAt
              ? `${kuwaitDateTime(a.acknowledgedAt)} (توقيت الكويت)`
              : 'لم يُقرّ بعد',
          ],
          ['عنوان IP', a.ip ?? '—'],
          ['بصمة الملحق (SHA-256)', a.documentHash],
        ],
      },
      { kind: 'heading', text: 'Addendum summary', dir: 'ltr' },
      {
        kind: 'kv',
        dir: 'ltr',
        rows: [
          ['Your spot', `${a.spot} of ${a.months}`],
          ['Monthly contribution', en(a.monthly)],
          ['You receive', `${en(a.expectedPayout)} on ${a.payoutDate}`],
          ['Acknowledged', a.acknowledgedAt ? kuwaitDateTime(a.acknowledgedAt) : 'not yet'],
        ],
      },
    ],
  };
}

// ── legal case file ──

export function caseFileDoc(f: AdminLegalCaseFile): PdfDoc {
  const statusAr: Record<string, string> = {
    OPEN: 'مفتوحة',
    SENT_TO_LAWYER: 'لدى المحامي',
    FILED: 'مرفوعة',
    JUDGMENT: 'صدر حكم',
    RECOVERING: 'قيد التحصيل',
    CLOSED: 'مغلقة',
  };
  const inst: Record<string, string> = {
    PAID: 'مدفوع',
    UNPAID: 'غير مدفوع',
    LATE: 'متأخر',
    COVERED: 'غُطّي جزئيًا (المبلغ المحتجز)',
    WAIVED: 'لا يلزم',
  };
  return {
    title: 'ملف قضية — Legal case file',
    reference: `CASE ${f.case.id.slice(0, 8)} · ${kuwaitDateTime(f.generatedAt)}`,
    createdAt: new Date(f.generatedAt),
    dir: 'rtl',
    watermark: 'سري — يحتوي بيانات هوية / Confidential — contains identity data',
    blocks: [
      { kind: 'title', text: `ملف قضية: ${f.member.fullNameAr ?? f.member.fullNameEn ?? ''}` },
      { kind: 'heading', text: 'بيانات الهوية' },
      {
        kind: 'kv',
        rows: [
          ['الاسم', `${f.member.fullNameAr ?? '—'} / ${f.member.fullNameEn ?? '—'}`],
          ['الرقم المدني', f.member.civilIdNumber ?? '—'],
          ['الجنسية', f.member.nationality ?? '—'],
          ['تاريخ الميلاد', f.member.dateOfBirth ?? '—'],
          ['العنوان', f.member.address ?? '—'],
          ['الهاتف', f.member.phone],
        ],
      },
      { kind: 'heading', text: 'المطالبة' },
      {
        kind: 'kv',
        rows: [
          ['حالة القضية', statusAr[f.case.status] ?? f.case.status],
          ['إجمالي المستحق', ar(f.case.grossOwed)],
          ['الاستقطاع المطبّق', ar(f.case.holdbackApplied)],
          ['صافي المطالبة', ar(f.case.netClaim)],
          ['المسترد', ar(f.case.recovered)],
          ['المتبقي', ar(f.case.outstanding)],
          ['الجمعية', f.circle.id],
          ['القسط الشهري', ar(f.circle.monthly)],
          ['الدور', String(f.circle.spot ?? '—')],
          ['بداية الجمعية', f.circle.startDate ?? '—'],
        ],
      },
      { kind: 'heading', text: 'العقد الموقّع' },
      f.contract
        ? {
            kind: 'kv',
            rows: [
              ['نسخة العقد', String(f.contract.version)],
              ['بصمة المستند', f.contract.documentHash],
              ['تاريخ التوقيع', `${kuwaitDateTime(f.contract.signedAt)} (توقيت الكويت)`],
              ['عنوان IP', f.contract.ip ?? '—'],
            ],
          }
        : { kind: 'paragraph', text: 'لا يوجد عقد موقّع.' },
      { kind: 'heading', text: 'الجدول مقابل المدفوع' },
      {
        kind: 'table',
        columns: [
          { label: 'الشهر', width: 1 },
          { label: 'الاستحقاق', width: 2 },
          { label: 'المبلغ', width: 2 },
          { label: 'الحالة', width: 2 },
          { label: 'تاريخ الدفع', width: 2.4 },
        ],
        rows: f.schedule.map((s) => [
          String(s.month),
          s.dueDate,
          ar(s.amount),
          inst[s.status] ?? s.status,
          kuwaitDateTime(s.paidAt),
        ]),
      },
      { kind: 'heading', text: 'إثبات التحويل' },
      f.payouts.length
        ? {
            kind: 'table',
            columns: [
              { label: 'النوع', width: 2 },
              { label: 'الشهر', width: 1 },
              { label: 'المبلغ', width: 2 },
              { label: 'التاريخ', width: 2.4 },
              { label: 'المرجع', width: 3 },
            ],
            rows: f.payouts.map((p) => [
              p.kind,
              String(p.month ?? '—'),
              ar(p.amount),
              kuwaitDateTime(p.sentAt),
              p.providerRef ?? '—',
            ]),
          }
        : { kind: 'paragraph', text: '—' },
      { kind: 'heading', text: 'سجل التذكيرات' },
      f.notifications.length
        ? {
            kind: 'table',
            columns: [
              { label: 'التاريخ', width: 2.4 },
              { label: 'الإشعار', width: 3 },
              { label: 'القنوات', width: 1.6 },
              { label: 'الحالة', width: 1.2 },
            ],
            rows: f.notifications.map((n) => [
              kuwaitDateTime(n.createdAt),
              n.eventKey,
              n.channels.join(', '),
              n.status,
            ]),
          }
        : { kind: 'paragraph', text: '—' },
      { kind: 'heading', text: 'سجل القضية' },
      f.events.length
        ? {
            kind: 'table',
            columns: [
              { label: 'التاريخ', width: 2.4 },
              { label: 'الحالة', width: 2 },
              { label: 'المسترد', width: 2 },
              { label: 'ملاحظة', width: 4 },
            ],
            rows: f.events.map((e) => [
              kuwaitDateTime(e.createdAt),
              statusAr[e.status] ?? e.status,
              e.amount ? ar(e.amount) : '—',
              e.note ?? '—',
            ]),
          }
        : { kind: 'paragraph', text: '—' },
    ],
  };
}
