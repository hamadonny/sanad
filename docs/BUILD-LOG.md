# Sanad — build log

Code lives in `C:\Users\User\Documents\Sanad` (git repo). Spec: `docs/SPEC.md`.
Working rule: stop after each phase for founder approval.

## Phase 0 — Foundation ✅ (2026-11-07) — approved

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

## Phase 1 — Core engine ✅ (2026-11-07) — awaiting approval

- `packages/config`: full versioned schema (all §5 numbers, bps/KWD integers), validation with cross-field rules, `diffConfig` for the admin diff preview.
- `packages/core`: rules, tiers & join eligibility, Kuwait-date schedule & installment status, risk (exposure, fund ratio, breaker hysteresis, reserve, release blocking), auction (one-spot rule, anti-snipe, identity-free view), provably fair draw (SHA-256 commit, HMAC-SHA256 Fisher–Yates, on-device verify), double-entry ledger (cash/claims sides, idempotency, reversals, fund-outflow guard), circle lifecycle reducer (FORMING→CLOSED incl. advances, held payouts, both default types, replacement, closing, release + retries, recoveries), scenario driver, Monte Carlo simulation + CLI.
- Tests: 104 in core (all §5.14 examples, 300-run property test; 3,000-run passes), coverage 99.6% stmts / 96.6% branches.
- Simulation sanity: d = 0.1 → 445.5 KWD loss/circle vs 450 expected.
- Decisions D-005 (ledger model), D-006 (engine shape + interpretations).

### Open questions raised in Phase 1

1. Worked example: A is "tier 1" but tier 1 has a 5% holdback → payout 905, not 955. Fixtures use tier 2 for A (and spot 3) to match the spec numbers. Which is intended?
2. Starting reserve: min reserve floor is 5,000 KWD; with an empty fund at launch every revenue release is blocked until the fund passes it. Will the company seed the fund with capital (needs a FUND_CAPITAL transaction type)? [DECISION][LEGAL]
3. Anti-sniping: extend end by +5 min (implemented) or reset to "now + 5 min"?
4. Bid cap: currently only Pot − holdback. Want a lower maximum?
5. Pre-payout default penalty destination (default charity) [LEGAL][SHARIAH].

## Next: Phase 2 — API (spec §7, §12–§15)
