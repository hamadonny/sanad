# Phase 6 — Hardening report (2026-11-08)

Security review, performance, accessibility, monitoring and privacy-safe analytics. Each
finding lists what was wrong (or missing), the fix, and the test that guards it.

## 1. Security review

Threat model: a fintech app holding identity documents and moving members' money. Main risks
are account takeover, staff-account takeover, data leaks (Civil ID, phone numbers), tampering
with money flows, and abuse of public endpoints.

| #   | Area              | Finding                                                                                                                           | Fix                                                                                                                              | Guarded by                              |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| S1  | API headers       | No security headers                                                                                                               | `helmet`: strict CSP (`default-src 'none'`), nosniff, no framing, HSTS in production, no `X-Powered-By`                          | `security.test.ts`                      |
| S2  | API docs          | Swagger UI served in production                                                                                                   | `/docs` only when `NODE_ENV` ≠ production                                                                                        | `main.ts`                               |
| S3  | Staff sign-in     | Unlimited password/2FA guesses (only per-IP throttle)                                                                             | Account locked for 15 min after 5 failures; failures audited (no password logged)                                                | `security.test.ts`                      |
| S4  | Uploads           | MIME type trusted from the client                                                                                                 | File bytes must match the declared type (JPEG/PNG/WebP/HEIC/PDF/DOCX) for Civil ID photos and legal documents                    | `file-type.test.ts`, `security.test.ts` |
| S5  | Rate limits       | Per-IP only — Kuwaiti carriers use carrier-grade NAT, so busy hours would block honest members                                    | Per session when signed in, per IP when signed out; 300/min default (`THROTTLE_PER_MINUTE`)                                      | load test below                         |
| S6  | Logs              | Driver errors could include query parameters (phones)                                                                             | Fixed in Phase 4; Phase 6 adds `scrub()` for every stored error/context                                                          | `scrub.test.ts`                         |
| S7  | Dashboard         | No security headers / CSP                                                                                                         | CSP (`frame-ancestors 'none'`, `form-action 'self'`, …), X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS (production) | `next.config.ts`                        |
| S8  | Dashboard session | (checked) httpOnly + SameSite=strict cookies, server-side API calls, single-flight refresh, server-action origin check by Next.js | —                                                                                                                                | `admin.test.ts` (unit)                  |
| S9  | Mobile            | Android cloud backup could copy app data                                                                                          | `android.allowBackup: false`; tokens already in Keychain/Keystore                                                                | `app.json`                              |
| S10 | Mobile            | Unused Android permissions                                                                                                        | Blocked: microphone, external storage, overlay                                                                                   | `app.json`                              |
| S11 | Codes             | Login and signing codes were already separated (Phase 5); OTP and signing SMS templates cannot be edited                          | —                                                                                                                                | `contracts.test.ts`                     |
| S12 | Store review      | Reviewers cannot receive Kuwaiti SMS                                                                                              | One allow-listed `REVIEW_PHONE` + fixed `REVIEW_CODE` (env, off when empty), constant-time compare, also for signing             | `security.test.ts`                      |
| S13 | CI                | Tests silently skipped in CI (Turborepo dropped `TEST_DATABASE_URL`)                                                              | `passThroughEnv` in `turbo.json`; `pnpm audit --prod --audit-level=high` step                                                    | CI                                      |

Checked and fine: money is integer fils everywhere; ledger append-only + balanced (DB triggers);
idempotency keys on money endpoints; signed payment webhooks with replay protection; refresh
token reuse detection; identity reads audited; members never see others' phones/IDs; dev
endpoints forced off in production; secrets required in production.

Dependency audit (production): 0 high/critical. 4 moderate + 1 low are inside Expo's CLI tooling
(`glob`, `minimatch`, `deepmerge`) — development tools, not shipped in the app or the API.

**Before launch (Phase 7)**: penetration test by an external firm; TLS + WAF at the hosting
provider; secrets in a managed vault; database encryption at rest and backups; staff accounts
only for real people, with least-privilege roles.

## 2. Performance

Load test on a development laptop container (20 concurrent connections, 8–10 s, autocannon):

| Endpoint               | Before                | After                                                                         |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `GET /health`          | 6,300 req/s, p50 2 ms | —                                                                             |
| `GET /me`              | 760 req/s, p50 25 ms  | —                                                                             |
| `GET /circles`         | 800 req/s, p50 22 ms  | —                                                                             |
| `GET /circles/options` | 186 req/s, p50 102 ms | **454 req/s, p50 41 ms** (eligibility loaded once instead of 4×, in parallel) |

Also: gzip compression for responses over 1 KB; new indexes for the hot scans
(`installments(status, due_date)`, `payments(status, succeeded_at)`,
`notifications(status, created_at)`, `audit_logs(action, created_at)`) — migration 0004.

## 3. Accessibility

Mobile (checked component by component): every button, switch, radio and card has a role,
label and state (disabled/busy/checked/selected); touch targets ≥ 48 pt; text scales with the
system font size (capped at 1.8× to keep layouts usable); colours meet WCAG AA (Ink on Flame
buttons, darker orange for text); Arabic text starts on the right on every platform; the sheet
backdrop now has a translated "close" label. Biometric prompts have text alternatives.

Dashboard: "Skip to content" link, labelled navigation landmarks, visible focus outlines, all
form fields labelled, `lang`/`dir` on every page, tables with header cells.

Still to do with real users: a VoiceOver/TalkBack pass on physical devices once the store
builds exist (Phase 6 follow-up after the developer accounts).

## 4. Error monitoring

Self-hosted, so data stays in Sanad's own database (simpler for data residency):

- API: every unexpected 500 is stored (scrubbed) with its route; optional `ALERT_WEBHOOK_URL`
  posts a one-line alert to Slack/Teams/Discord, at most once per error type per 10 minutes.
- App: crashes during rendering (error screen with retry), unhandled JS errors and unexpected
  request failures are reported to `POST /telemetry/errors` (no user id; scrubbed again).
- Dashboard: page crashes are reported the same way.
- Dashboard → Monitoring shows error groups (count, last seen, platforms, versions, stack).

A third-party service (e.g. Sentry) can be added later behind the same calls if wanted.

## 5. Privacy-safe analytics

Anonymous daily counts only: `analytics_daily(day, event, platform, app_version, count)`. No
user id, device id, IP or phone is sent or stored; only 14 known event names are accepted.
Members can switch it off (Profile → Share anonymous usage statistics). Dashboard → Monitoring
shows the member journey (app open → sign-in → identity → join → sign → pay).
