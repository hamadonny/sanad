# Sanad — build log

Code lives in `C:\Users\User\Documents\Sanad` (git repo). Spec: `docs/SPEC.md`.
Working rule: stop after each phase for founder approval.

## Phase 0 — Foundation ✅ (2026-11-07) — awaiting approval

- pnpm 10 + Turborepo monorepo; TypeScript 6 strict; ESLint 10 flat + Prettier; Vitest 5.
- apps: `api` (NestJS 12, `GET /health`), `admin` (Next.js 16, Arabic RTL page), `mobile` (Expo SDK 58 + Expo Router, Arabic RTL screen).
- packages: `core` (bigint fils money primitives, 100% coverage, 95% threshold enforced), `config` (zod skeleton), `i18n` (ar default/en, key parity test), `ui-tokens` (placeholder brand).
- Docker Compose: Postgres 17, Redis 7, Mailpit. GitHub Actions CI: format, lint, typecheck, test, build.
- Decisions: see `docs/DECISIONS.md` (D-001 money = bigint fils; D-002 versions; D-003 built shared packages; D-004 Arabic default).

### Founder answers (2026-11-07)

1. `allowTier0Bidding` = **true** at launch (10% holdback applies).
2. Brand colours/fonts — still placeholders (teal/gold, IBM Plex Sans Arabic + Inter).
3. Bundle id / package name **`kw.sanad.app`** — confirmed.
4. GitHub repo — yes; founder creates it and pushes from their PC.
5. iOS Expo Go needs the same Expo account signed in on the PC (`npx expo login`) and in Expo Go.

## Next: Phase 1 — Core engine (spec §5, §6)
