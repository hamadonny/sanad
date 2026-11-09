import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuth, createTestApp, dbAvailable, signUp, type TestApp } from './helpers.js';

describe.skipIf(!dbAvailable)('admin dashboard API (Phase 4)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('who am I, and members search with phones masked for viewers', async () => {
    const m = await signUp(t, 'Search Target');
    const ops = await adminAuth(t, ['ops']);
    const me = (await t.http.get('/admin/me').set(ops).expect(200)).body;
    expect(me.roles).toEqual(['ops']);
    const byName = (await t.http.get('/admin/members?q=search tar').set(ops).expect(200)).body;
    expect(byName.map((x: { id: string }) => x.id)).toContain(m.id);
    const byPhone = (
      await t.http
        .get(`/admin/members?q=${m.phone.slice(-6)}`)
        .set(ops)
        .expect(200)
    ).body;
    expect(byPhone[0]).toMatchObject({ id: m.id, phone: m.phone });
    const viewer = await adminAuth(t, ['viewer']);
    const masked = (await t.http.get(`/admin/members/${m.id}`).set(viewer).expect(200)).body;
    expect(masked.user.phone).toBe(`${m.phone.slice(0, 4)}••••${m.phone.slice(-4)}`);
  });

  it('role permissions: viewer is read-only, kyc reviewers cannot see members, finance cannot ban', async () => {
    const m = await signUp(t, 'Role Check');
    const viewer = await adminAuth(t, ['viewer']);
    await t.http.get('/admin/payments/board').set(viewer).expect(200);
    await t.http
      .post(`/admin/members/${m.id}/ban`)
      .set(viewer)
      .send({ reason: 'x'.repeat(5) })
      .expect(403);
    await t.http.post('/admin/config/preview').set(viewer).send({ config: {} }).expect(403);
    const kyc = await adminAuth(t, ['kyc_reviewer']);
    await t.http.get('/admin/members').set(kyc).expect(403);
    await t.http.get('/admin/ledger/accounts').set(kyc).expect(403);
    const fin = await adminAuth(t, ['finance']);
    await t.http
      .post(`/admin/members/${m.id}/ban`)
      .set(fin)
      .send({ reason: 'fraud check' })
      .expect(403);
    const ops = await adminAuth(t, ['ops']);
    const banned = (
      await t.http
        .post(`/admin/members/${m.id}/ban`)
        .set(ops)
        .send({ reason: 'fraud check' })
        .expect(201)
    ).body;
    expect(banned.user).toMatchObject({ status: 'BANNED', bannedReason: 'fraud check' });
    await t.http
      .post(`/admin/members/${m.id}/unban`)
      .set(ops)
      .send({ reason: 'cleared' })
      .expect(201);
    await t.http.get('/admin/audit').set(ops).expect(403);
  });

  it('notification templates: edit with known placeholders only; OTP SMS is locked', async () => {
    const ops = await adminAuth(t, ['ops']);
    const list = (await t.http.get('/admin/content/templates').set(ops).expect(200)).body;
    expect(list.find((x: { key: string }) => x.key === 'auth.otp')).toBeUndefined();
    const late = list.find((x: { key: string }) => x.key === 'payment.late');
    expect(late.placeholders.length).toBeGreaterThan(0);
    const bad = await t.http
      .put('/admin/content/templates/payment.late/ar')
      .set(ops)
      .send({ title: 'تأخر', body: 'ادفع {{hack}}' })
      .expect(422);
    expect(bad.body.code).toBe('UNKNOWN_PLACEHOLDER');
    const ph = late.placeholders[0] as string;
    const ok = (
      await t.http
        .put('/admin/content/templates/payment.late/ar')
        .set(ops)
        .send({ title: 'قسطك متأخر', body: `يرجى السداد {{${ph}}}` })
        .expect(200)
    ).body;
    expect(ok).toMatchObject({ customized: true, ar: { title: 'قسطك متأخر' } });
    await t.http
      .put('/admin/content/templates/auth.otp/ar')
      .set(ops)
      .send({ title: 'x', body: 'y' })
      .expect(404);
  });

  it('contracts: legal publishes a new version and members must sign again', async () => {
    const m = await signUp(t, 'Signer');
    const before = (await t.http.get('/contracts/current').set(m.auth).expect(200)).body;
    expect(before.signed).toBe(true);
    const legal = await adminAuth(t, ['legal']);
    const c = (
      await t.http
        .post('/admin/content/contracts')
        .set(legal)
        .send({
          titleAr: 'عقد عضوية سند — الإصدار ٢',
          titleEn: 'Sanad membership agreement v2',
          bodyAr: 'نص قانوني جديد معتمد من المحامي للاختبار فقط.',
          bodyEn: 'New lawyer-approved legal text, for testing only.',
        })
        .expect(201)
    ).body;
    expect(c.version).toBe(before.version + 1);
    const after = (await t.http.get('/contracts/current').set(m.auth).expect(200)).body;
    expect(after).toMatchObject({ version: c.version, signed: false });
    const ops = await adminAuth(t, ['ops']);
    await t.http.post('/admin/content/contracts').set(ops).send({}).expect(403);
  });

  it('FAQ: seeded from the app, editable, public list shows published items only', async () => {
    const ops = await adminAuth(t, ['ops']);
    const seeded = (await t.http.get('/admin/content/faq').set(ops).expect(200)).body;
    expect(seeded.length).toBe(5);
    const item = (
      await t.http
        .post('/admin/content/faq')
        .set(ops)
        .send({
          questionAr: 'سؤال مخفي؟',
          answerAr: 'جواب مخفي.',
          questionEn: 'Hidden question?',
          answerEn: 'Hidden answer.',
          position: 9,
          published: false,
        })
        .expect(201)
    ).body;
    const pub = (await t.http.get('/content/faq').expect(200)).body;
    expect(pub.map((x: { id: string }) => x.id)).not.toContain(item.id);
    await t.http
      .put(`/admin/content/faq/${item.id as string}`)
      .set(ops)
      .send({ ...item, id: undefined, published: true })
      .expect(200);
    expect((await t.http.get('/content/faq').expect(200)).body).toHaveLength(6);
    await t.http
      .delete(`/admin/content/faq/${item.id as string}`)
      .set(ops)
      .expect(204);
  });

  it('support tickets: listed and updated by ops', async () => {
    const m = await signUp(t, 'Ticket Writer');
    await t.http
      .post('/support/tickets')
      .set(m.auth)
      .send({ subject: 'Help please', body: 'My payment shows pending.' })
      .expect(201);
    const ops = await adminAuth(t, ['ops']);
    const open = (await t.http.get('/admin/support?status=OPEN').set(ops).expect(200)).body;
    const ticket = open.find((x: { userId: string }) => x.userId === m.id);
    expect(ticket).toMatchObject({ subject: 'Help please', name: 'Ticket Writer' });
    await t.http
      .post(`/admin/support/${ticket.id as string}`)
      .set(ops)
      .send({ status: 'CLOSED', note: 'Webhook delayed; resolved.' })
      .expect(204);
    const mine = (await t.http.get(`/admin/members/${m.id}`).set(ops).expect(200)).body;
    expect(mine.tickets[0]).toMatchObject({ status: 'CLOSED' });
  });

  it('config versions list includes the seed version', async () => {
    const sa = await adminAuth(t);
    const v = (await t.http.get('/admin/config/versions').set(sa).expect(200)).body;
    expect(v[0].version).toBeGreaterThanOrEqual(1);
  });
});
