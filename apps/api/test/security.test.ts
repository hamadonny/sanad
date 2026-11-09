import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../src/common/totp.js';
import { AdminService } from '../src/admin/admin.service.js';
import { adminAuth, createTestApp, dbAvailable, type TestApp } from './helpers.js';

describe.skipIf(!dbAvailable)(
  'Phase 6 hardening: headers, lockout, uploads, monitoring, review account',
  () => {
    let t: TestApp;
    beforeAll(async () => {
      process.env.REVIEW_PHONE = '90000001';
      process.env.REVIEW_CODE = '246810';
      t = await createTestApp();
    });
    afterAll(async () => {
      delete process.env.REVIEW_PHONE;
      delete process.env.REVIEW_CODE;
      await t?.close();
    });

    it('sends security headers', async () => {
      const r = await t.http.get('/health').expect(200);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-security-policy']).toContain("default-src 'none'");
      expect(r.headers['x-powered-by']).toBeUndefined();
    });

    it('locks an admin account after 5 failed sign-ins (and audits the failures)', async () => {
      const email = 'locked@sanad.test';
      const password = 'correct-horse-battery-staple';
      const { totpSecret } = await t
        .get<AdminService>(AdminService)
        .createAdmin(email, password, ['ops']);
      for (let i = 0; i < 5; i += 1)
        await t.http
          .post('/admin/auth/login')
          .send({ email, password: 'wrong-password-123', totp: '000000' })
          .expect(401);
      const r = await t.http
        .post('/admin/auth/login')
        .send({ email, password, totp: totpAt(totpSecret, t.clock.now().getTime()) })
        .expect(429);
      expect(r.body.code).toBe('ADMIN_LOCKED');
      t.clock.advance(16 * 60_000);
      await t.http
        .post('/admin/auth/login')
        .send({ email, password, totp: totpAt(totpSecret, t.clock.now().getTime()) })
        .expect(200);
      t.clock.set(null);
    });

    it('rejects uploads whose bytes do not match the declared type', async () => {
      const legal = await adminAuth(t, ['legal']);
      const r = await t.http
        .post('/admin/legal-docs')
        .set(legal)
        .field('kind', 'SHARIAH_REVIEW')
        .field('title', 'Fake')
        .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), {
          filename: 'review.pdf',
          contentType: 'application/pdf',
        })
        .expect(422);
      expect(r.body.code).toBe('FILE_TYPE');
    });

    it('stores client errors without personal data and counts anonymous events', async () => {
      await t.http
        .post('/telemetry/errors')
        .send({
          source: 'mobile',
          message: 'TypeError: failed for +96550001234 civil 290010112345',
          stack: 'at Home (index.tsx:10)\nBearer eyJhbGciOi.eyJzdWIiOi.abcdefghijk',
          context: 'home',
          platform: 'ios',
          appVersion: '1.0.0',
        })
        .expect(204);
      await t.http
        .post('/telemetry/events')
        .send({
          platform: 'ios',
          appVersion: '1.0.0',
          events: [
            { name: 'app_open' },
            { name: 'app_open' },
            { name: 'payment_completed', n: 2 },
            { name: 'evil_tracking' },
          ],
        })
        .expect(200, { accepted: 4 });
      const ops = await adminAuth(t, ['ops']);
      const errors = (await t.http.get('/admin/monitoring/errors').set(ops).expect(200)).body;
      const mine = errors.find((e: { context: string }) => e.context === 'home');
      expect(mine.message).not.toMatch(/50001234|290010112345/);
      expect(mine.stack).not.toContain('eyJhbGciOi');
      const a = (await t.http.get('/admin/monitoring/analytics').set(ops).expect(200)).body;
      expect(a.totals).toMatchObject({ app_open: 2, payment_completed: 2 });
      expect(a.totals.evil_tracking).toBeUndefined();
      await t.http
        .get('/admin/monitoring/errors')
        .set(await adminAuth(t, ['viewer']))
        .expect(403);
    });

    it('store review account: no SMS, fixed code signs in and signs the contract', async () => {
      const phone = '+96590000001';
      const req = (await t.http.post('/auth/otp/request').send({ phone }).expect(200)).body;
      expect(req.devCode).toBeUndefined();
      expect(t.sms.lastTo(phone)).toBeUndefined();
      await t.http.post('/auth/otp/verify').send({ phone, code: '111111' }).expect(401);
      const v = (await t.http.post('/auth/otp/verify').send({ phone, code: '246810' }).expect(200))
        .body;
      const auth = { Authorization: `Bearer ${v.accessToken as string}` };
      const c = (await t.http.get('/contracts/current').set(auth).expect(200)).body;
      await t.http
        .post('/contracts/sign/request')
        .set(auth)
        .send({ version: c.version })
        .expect(200);
      await t.http
        .post('/contracts/sign')
        .set(auth)
        .send({ version: c.version, code: '246810' })
        .expect(200);
    });
  },
);
