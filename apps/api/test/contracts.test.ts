import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuth, binary, createTestApp, dbAvailable, signUp, type TestApp } from './helpers.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe.skipIf(!dbAvailable)('contracts, e-signature and legal documents (Phase 5)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('signing needs a signing code: wrong code fails, login codes cannot sign, a PDF is kept', async () => {
    const m = await signUp(t, 'Signer One', { sign: false });
    const c = (await t.http.get('/contracts/current').set(m.auth).expect(200)).body;
    expect(c).toMatchObject({ signed: false, legal: { lawyerApproved: false, shariah: null } });
    // Amounts stay open in the list (signing is part of the join flow) but joining is blocked.
    const opts = (await t.http.get('/circles/options').set(m.auth).expect(200)).body;
    expect(opts.options[0]).toMatchObject({ available: true });
    const blocked = await t.http
      .post('/circles/queue')
      .set(m.auth)
      .set('Idempotency-Key', `unsigned-${m.id}`)
      .send({ monthlyKwd: 50 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('CONTRACT_NOT_SIGNED');
    await t.http
      .post('/contracts/sign')
      .set(m.auth)
      .send({ version: c.version, code: '000000' })
      .expect(401);
    // A login code (purpose LOGIN) must not sign.
    const login = (await t.http.post('/auth/otp/request').send({ phone: m.phone }).expect(200))
      .body;
    await t.http
      .post('/contracts/sign')
      .set(m.auth)
      .send({ version: c.version, code: login.devCode })
      .expect(401);
    const req = (
      await t.http
        .post('/contracts/sign/request')
        .set(m.auth)
        .send({ version: c.version })
        .expect(200)
    ).body;
    expect(req.devCode).toMatch(/^\d{6}$/);
    expect(t.sms.lastTo(m.phone)).toContain(req.devCode as string);
    // …and a signing code must not sign in.
    await t.http.post('/auth/otp/verify').send({ phone: m.phone, code: req.devCode }).expect(401);
    const signed = (
      await t.http
        .post('/contracts/sign')
        .set(m.auth)
        .send({ version: c.version, code: req.devCode })
        .expect(200)
    ).body;
    expect(signed).toMatchObject({ version: c.version, documentHash: c.sha256 });
    const list = (await t.http.get('/contracts/signatures').set(m.auth).expect(200)).body;
    expect(list[0]).toMatchObject({ kind: 'MEMBERSHIP', hasPdf: true });
    const file = await t.http
      .get(`/contracts/signatures/${list[0].id as string}/pdf`)
      .set(m.auth)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Another member cannot download it.
    const other = await signUp(t, 'Other Person');
    await t.http
      .get(`/contracts/signatures/${list[0].id as string}/pdf`)
      .set(other.auth)
      .expect(404);
    // Staff (ops/legal) can, and the read is audited.
    const ops = await adminAuth(t, ['ops']);
    await t.http
      .get(`/admin/signatures/${list[0].id as string}/pdf`)
      .set(ops)
      .expect(200);
  });

  it('legal documents: placeholders until the founder uploads the lawyer contract and Shariah review', async () => {
    const before = (await t.http.get('/content/legal-status').expect(200)).body;
    expect(before).toMatchObject({ lawyerApproved: false, shariah: null });
    const legal = await adminAuth(t, ['legal']);
    const ops = await adminAuth(t, ['ops']);
    await t.http
      .post('/admin/legal-docs')
      .set(ops)
      .field('kind', 'SHARIAH_REVIEW')
      .field('title', 'x')
      .attach('file', pdf, { filename: 'r.pdf', contentType: 'application/pdf' })
      .expect(403);
    await t.http
      .post('/admin/legal-docs')
      .set(legal)
      .field('kind', 'CONTRACT_SOURCE')
      .field('title', 'Final contract')
      .attach('file', Buffer.from('MZ'), {
        filename: 'x.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(422);
    const contractDoc = (
      await t.http
        .post('/admin/legal-docs')
        .set(legal)
        .field('kind', 'CONTRACT_SOURCE')
        .field('title', 'عقد العضوية — نسخة المحامي')
        .field('contractVersion', String(before.contractVersion))
        .attach('file', pdf, { filename: 'contract.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body;
    expect(contractDoc).toMatchObject({ kind: 'CONTRACT_SOURCE', status: 'UPLOADED' });
    const pending = (
      await t.http
        .post('/admin/legal-docs')
        .set(legal)
        .field('kind', 'SHARIAH_REVIEW')
        .field('title', 'Shariah opinion (draft)')
        .field('status', 'PENDING')
        .attach('file', pdf, { filename: 'review.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body;
    // Pending reviews are not downloadable by the public; contract sources never are.
    await t.http.get(`/content/legal-docs/${pending.id as string}/file`).expect(404);
    await t.http.get(`/content/legal-docs/${contractDoc.id as string}/file`).expect(404);
    const approved = (
      await t.http
        .post('/admin/legal-docs')
        .set(legal)
        .field('kind', 'SHARIAH_REVIEW')
        .field('title', 'Shariah opinion')
        .field('status', 'APPROVED')
        .field('reviewer', 'Shariah Board')
        .field('reviewedOn', '2027-01-10')
        .attach('file', pdf, { filename: 'review.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body;
    const after = (await t.http.get('/content/legal-status').expect(200)).body;
    expect(after).toMatchObject({
      lawyerApproved: true,
      shariah: { status: 'APPROVED', reviewer: 'Shariah Board', downloadable: true },
    });
    const dl = await t.http
      .get(`/content/legal-docs/${approved.id as string}/file`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((dl.body as Buffer).equals(pdf)).toBe(true);
    const list = (await t.http.get('/admin/legal-docs').set(ops).expect(200)).body;
    expect(list.documents).toHaveLength(3);
    const ov = (
      await t.http
        .get('/admin/overview')
        .set(await adminAuth(t))
        .expect(200)
    ).body;
    expect(ov.legal.lawyerApproved).toBe(true);
    const audit = (
      await t.http
        .get('/admin/audit?action=legal_doc')
        .set(await adminAuth(t))
        .expect(200)
    ).body;
    expect(audit.length).toBe(3);
  });

  it('receipts are real PDFs, only for paid payments', async () => {
    const m = await signUp(t, 'Receipt Person');
    const intent = (
      await t.http
        .post('/circles/queue')
        .set(m.auth)
        .set('Idempotency-Key', `rk-${m.id}`)
        .send({ monthlyKwd: 50 })
        .expect(201)
    ).body;
    const pid = intent.payment.id as string;
    await t.http.get(`/payments/${pid}/receipt`).set(m.auth).expect(404);
    await t.http.post(`/payments/dev/${pid}/confirm`).set(m.auth).expect(200);
    const r = await t.http
      .get(`/payments/${pid}/receipt`)
      .set(m.auth)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
