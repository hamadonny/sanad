import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuth, createTestApp, dbAvailable, signUp, type TestApp } from './helpers.js';

describe.skipIf(!dbAvailable)('auth, profile, KYC, contracts', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('health reports the database', async () => {
    const r = await t.http.get('/health').expect(200);
    expect(r.body).toMatchObject({ status: 'ok', database: 'up', businessTimezone: 'Asia/Kuwait' });
  });

  it('rejects non-Kuwaiti numbers and wrong codes', async () => {
    await t.http.post('/auth/otp/request').send({ phone: '+15551234567' }).expect(400);
    await t.http.post('/auth/otp/request').send({ phone: '+96560000001' }).expect(200);
    const r = await t.http.post('/auth/otp/verify').send({ phone: '+96560000001', code: '000000' });
    expect([401]).toContain(r.status);
    expect(r.body.code).toBe('INVALID_CODE');
  });

  it('dev mode: returns the mock code, and allow-listed phones sign in without one', async () => {
    const r = await t.http.post('/auth/otp/request').send({ phone: '50000052' }).expect(200);
    expect(r.body.devCode).toMatch(/^\d{6}$/);
    expect(t.sms.lastTo('+96550000052')).toContain(r.body.devCode as string);
    await t.http
      .post('/auth/otp/verify')
      .send({ phone: '+96550000052', code: r.body.devCode })
      .expect(200);

    const d = await t.http.post('/auth/otp/request').send({ phone: '9930 2447' }).expect(200);
    expect(d.body).toMatchObject({ devLogin: true });
    expect(d.body.devCode).toBeUndefined();
    const s = await t.http.post('/auth/dev-login').send({ phone: '+96599302447' }).expect(200);
    await t.http
      .get('/me')
      .set('Authorization', `Bearer ${s.body.accessToken as string}`)
      .expect(200);
    const no = await t.http.post('/auth/dev-login').send({ phone: '+96550000052' }).expect(403);
    expect(no.body.code).toBe('DEV_LOGIN_NOT_ALLOWED');
  });

  it('rate-limits OTP requests per phone', async () => {
    for (let i = 0; i < 5; i += 1)
      await t.http.post('/auth/otp/request').send({ phone: '+96560000002' }).expect(200);
    const r = await t.http.post('/auth/otp/request').send({ phone: '+96560000002' }).expect(429);
    expect(r.body.code).toBe('OTP_RATE_LIMIT');
  });

  it('signs up, rotates refresh tokens and detects reuse', async () => {
    const phone = '+96560000003';
    await t.http.post('/auth/otp/request').send({ phone }).expect(200);
    const code = /(\d{6})/.exec(t.sms.lastTo(phone) ?? '')?.[1];
    const v = await t.http.post('/auth/otp/verify').send({ phone, code }).expect(200);
    expect(v.body.isNew).toBe(true);
    const r1 = await t.http
      .post('/auth/refresh')
      .send({ refreshToken: v.body.refreshToken })
      .expect(200);
    await t.http
      .get('/me')
      .set('Authorization', `Bearer ${r1.body.accessToken as string}`)
      .expect(200);
    // Reusing the old refresh token revokes the whole family.
    await t.http.post('/auth/refresh').send({ refreshToken: v.body.refreshToken }).expect(401);
    await t.http.post('/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await t.http.get('/me').expect(401);
  });

  it('profile shows tier 0 and progress to tier 1', async () => {
    const m = await signUp(t, 'Fatima Al-Ali');
    const me = await t.http.get('/me').set(m.auth).expect(200);
    expect(me.body).toMatchObject({
      kycStatus: 'APPROVED',
      fullNameEn: 'Fatima Al-Ali',
      trust: { tier: 0, banned: false, nextTier: { tier: 1, completedCirclesNeeded: 1 } },
    });
    const p = await t.http.patch('/me').set(m.auth).send({ language: 'en' }).expect(200);
    expect(p.body.language).toBe('en');
    expect(me.body).not.toHaveProperty('civilIdHash');
  });

  it('one account per Civil ID', async () => {
    const a = await signUp(t, 'Dup One', { kyc: false });
    const b = await signUp(t, 'Dup Two', { kyc: false });
    const body = {
      fullNameAr: 'س',
      fullNameEn: 'Dup',
      civilIdNumber: '299999999999',
      nationality: 'KW',
      dateOfBirth: '1990-01-01',
      civilIdExpiry: '2035-01-01',
      address: 'Kuwait',
    };
    await t.http
      .post('/kyc/submissions')
      .set(a.auth)
      .send({ ...body, fullNameAr: 'عضو' })
      .expect(201);
    const r = await t.http
      .post('/kyc/submissions')
      .set(b.auth)
      .send({ ...body, fullNameAr: 'عضو' })
      .expect(409);
    expect(r.body.code).toBe('DUPLICATE_CIVIL_ID');
  });

  it('rejects an expired Civil ID', async () => {
    const m = await signUp(t, 'Expired Person', { kyc: false });
    const r = await t.http
      .post('/kyc/submissions')
      .set(m.auth)
      .send({
        fullNameAr: 'عضو',
        fullNameEn: 'X Y',
        civilIdNumber: '288888888888',
        nationality: 'KW',
        dateOfBirth: '1990-01-01',
        civilIdExpiry: '2020-01-01',
        address: 'Kuwait',
      })
      .expect(422);
    expect(r.body.code).toBe('CIVIL_ID_EXPIRED');
  });

  it('manual review queue: admin approves, the read is audited', async () => {
    const t2 = await createTestApp({ identity: 'manual' });
    try {
      const m = await signUp(t2, 'Review Me', { kyc: false });
      const png = Buffer.from('89504e470d0a1a0a', 'hex');
      const sub = await t2.http
        .post('/kyc/submissions')
        .set(m.auth)
        .field('fullNameAr', 'عضو')
        .field('fullNameEn', 'Review Me')
        .field('civilIdNumber', '277777777777')
        .field('nationality', 'KW')
        .field('dateOfBirth', '1991-02-02')
        .field('civilIdExpiry', '2034-01-01')
        .field('address', 'Salmiya')
        .attach('front', png, { filename: 'f.png', contentType: 'image/png' })
        .attach('back', png, { filename: 'b.png', contentType: 'image/png' })
        .attach('selfie', png, { filename: 's.png', contentType: 'image/png' })
        .expect(201);
      expect(sub.body.status).toBe('PENDING_REVIEW');
      const admin = await adminAuth(t2, ['kyc_reviewer']);
      const queue = await t2.http.get('/admin/kyc').set(admin).expect(200);
      expect(queue.body).toHaveLength(1);
      const detail = await t2.http
        .get(`/admin/kyc/${sub.body.id as string}`)
        .set(admin)
        .expect(200);
      expect(detail.body.civilIdNumber).toBe('277777777777');
      const doc = await t2.http
        .get(`/admin/kyc/${sub.body.id as string}/documents/front`)
        .set(admin)
        .expect(200);
      expect(Buffer.from(doc.body as Buffer).equals(png)).toBe(true);
      await t2.http
        .post(`/admin/kyc/${sub.body.id as string}/approve`)
        .set(admin)
        .send({})
        .expect(204);
      const me = await t2.http.get('/me').set(m.auth).expect(200);
      expect(me.body.kycStatus).toBe('APPROVED');
      // kyc_reviewer cannot publish config or read the audit log
      await t2.http.get('/admin/audit').set(admin).expect(403);
      const sa = await adminAuth(t2);
      const audit = await t2.http.get('/admin/audit').set(sa).expect(200);
      expect((audit.body as { action: string }[]).map((a) => a.action)).toEqual(
        expect.arrayContaining(['kyc.read_identity', 'kyc.read_document', 'kyc.approved']),
      );
    } finally {
      await t2.close();
    }
  });

  it('account deletion works when not in a circle', async () => {
    const m = await signUp(t, 'Leaving Soon');
    await t.http.delete('/me').set(m.auth).expect(204);
  });

  it('admin login requires the 2FA code', async () => {
    await t.http
      .post('/admin/auth/login')
      .send({
        email: 'nobody@sanad.test',
        password: 'correct-horse-battery-staple',
        totp: '123456',
      })
      .expect(401);
  });
});
