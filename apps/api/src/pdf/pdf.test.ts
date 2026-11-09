import { describe, expect, it } from 'vitest';
import { contractDoc, groupKwd, kuwaitDateTime, receiptDoc } from './documents.js';
import { layoutLine, PdfKitGenerator } from './pdfkit.generator.js';

const order = (placed: { word: string; x: number }[]) =>
  [...placed].sort((a, b) => a.x - b.x).map((p) => p.word);

describe('bidi line layout', () => {
  it('Arabic paragraph: words run right-to-left, numbers stay left-to-right inside', () => {
    // "المبلغ 955.000 د.ك" → visually (left→right): د.ك 955.000 المبلغ
    const placed = layoutLine(['المبلغ', '955.000', 'د.ك'], [40, 50, 20], 5, 'rtl', 200);
    expect(order(placed)).toEqual(['د.ك', '955.000', 'المبلغ']);
    expect(Math.max(...placed.map((p) => p.x + 40))).toBeLessThanOrEqual(200);
  });
  it('a run of several Latin words keeps its order inside an Arabic line', () => {
    const placed = layoutLine(['عبر', 'Sanad', 'app'], [20, 30, 20], 5, 'rtl', 200);
    expect(order(placed)).toEqual(['Sanad', 'app', 'عبر']);
  });
  it('English paragraph with an Arabic name: the Arabic words run right-to-left', () => {
    const placed = layoutLine(['Name:', 'فاطمة', 'أحمد', 'ok'], [30, 30, 30, 15], 5, 'ltr', 300);
    expect(order(placed)).toEqual(['Name:', 'أحمد', 'فاطمة', 'ok']);
  });
});

describe('documents', () => {
  it('formats money and Kuwait time', () => {
    expect(groupKwd('1234567.500')).toBe('1,234,567.500');
    expect(kuwaitDateTime('2027-01-01T21:30:00Z')).toBe('2027-01-02 00:30');
  });

  it('renders a bilingual receipt and a placeholder-marked contract as PDF', async () => {
    const g = new PdfKitGenerator();
    const receipt = await g.render(
      receiptDoc({
        id: '6f1c2b2e-0000-4000-8000-000000000001',
        purpose: 'CONTRIBUTION',
        circleId: '7a1c2b2e-0000-4000-8000-000000000002',
        month: 3,
        amount: { fils: '105000', kwd: '105.000' },
        penalty: { fils: '5000', kwd: '5.000' },
        status: 'APPLIED',
        paidAt: new Date('2027-03-15T10:00:00Z'),
        createdAt: new Date('2027-03-15T09:59:00Z'),
        memberName: 'فاطمة أحمد',
        phoneMasked: '+965••••0001',
        providerRef: 'mock_1',
      }),
    );
    expect(receipt.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = contractDoc({
      version: 1,
      titleAr: 'عقد عضوية سند',
      titleEn: 'Sanad agreement',
      bodyAr: 'نص مؤقت (مسودة).',
      bodyEn: 'Placeholder text.',
      textHash: 'a'.repeat(64),
      signer: {
        name: 'فاطمة',
        nameEn: 'Fatima',
        civilIdMasked: '290••••••001',
        phoneMasked: '+965••••0001',
      },
      signedAt: new Date('2027-01-01T07:00:00Z'),
      ip: '127.0.0.1',
      device: 'test',
      otpReference: 'otp-1',
      legal: { lawyerApproved: false, shariah: null },
    });
    expect(doc.watermark).toMatch(/Placeholder/);
    expect(doc.blocks.some((b) => b.kind === 'banner')).toBe(true);
    const pdf = await g.render(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.includes(Buffer.from('ReadexPro'))).toBe(true); // font embedded
  });
});
