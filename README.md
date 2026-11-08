# Sanad · سند

Guaranteed digital jamiya (rotating savings circle) for Kuwait — mobile app, API and admin
dashboard. Full product spec: [docs/SPEC.md](docs/SPEC.md). Technical decisions:
[docs/DECISIONS.md](docs/DECISIONS.md).

> **Safety:** this codebase never moves real money or verifies real identities. Every payment,
> identity, SMS and e-signature integration is a mock until Phase 7 and the founder's written
> go-ahead.

## Repository layout

```
apps/
  api/        NestJS API            → http://localhost:3000/health
  admin/      Next.js admin         → http://localhost:3001
  mobile/     Expo (iOS + Android)  → Expo Go / simulator
packages/
  core/       Pure financial engine (no I/O). Money = bigint fils.
  config/     Business-rule config schema + defaults (zod)
  i18n/       Arabic (default) + English strings
  ui-tokens/  Colours, spacing, typography
docs/         Spec and decision records
```

## Prerequisites

- **Node.js 22** (LTS) — https://nodejs.org
- **pnpm 10** — `corepack enable` (ships with Node), then `corepack prepare pnpm@10.28.0 --activate`
- **Docker Desktop** — for Postgres, Redis and Mailpit (needed from Phase 2)
- **Git**
- For the mobile app: the **Expo Go** app on your phone, or Android Studio / Xcode simulators

On Windows, run the commands below in PowerShell or Windows Terminal from the repo folder.

## First run

```bash
pnpm install          # install everything
cp .env.example .env  # Windows PowerShell: Copy-Item .env.example .env
pnpm build            # build shared packages + apps
```

## Day-to-day commands

| Command           | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `pnpm dev:api`    | API with hot reload on port 3000                       |
| `pnpm dev:admin`  | Admin dashboard on port 3001                           |
| `pnpm dev:mobile` | Expo dev server — scan the QR code with Expo Go        |
| `pnpm dev`        | API + admin + mobile together                          |
| `pnpm test`       | All unit tests (core enforces ≥ 95% coverage)          |
| `pnpm lint`       | ESLint everywhere                                      |
| `pnpm typecheck`  | TypeScript strict checks everywhere                    |
| `pnpm format`     | Prettier                                               |
| `pnpm infra:up`   | Start Postgres (5432), Redis (6379), Mailpit (8025 UI) |
| `pnpm infra:down` | Stop them                                              |

Quick check that the API is alive:

```bash
curl http://localhost:3000/health
```

### Mobile on a real phone

`pnpm dev:mobile`, then scan the QR code with Expo Go (Android) or the Camera app (iOS). Your
phone and computer must be on the same Wi-Fi. When the app starts calling the API (Phase 3), set
`EXPO_PUBLIC_API_URL` in `.env` to your computer's LAN IP, e.g. `http://192.168.1.20:3000`.

## Mobile app (apps/mobile)

Expo SDK 58 + Expo Router. Arabic (RTL) first, English second. Talks to the API with the typed
client in `packages/api-client`.

```bash
pnpm dev:api        # in one terminal (Docker running, DB migrated + seeded)
pnpm dev:mobile     # in another — scan the QR code with Expo Go
```

The app finds the API automatically at `http://<your computer's IP>:3000` (the same machine as
the Expo dev server). Set `EXPO_PUBLIC_API_URL` to override. Allow Node through the Windows
firewall the first time.

Try it with a seeded member: phone `50000052` (ACTIVE circle) or `50000063` (circle in its
auction). The OTP is at `http://localhost:3000/dev/sms?phone=%2B96550000052`.
Payments use the **mock gateway**: the confirmation sheet's Pay button simulates the gateway.

- Screens: onboarding (language, slides, phone + OTP, identity with camera, notifications),
  home, join (calculator, random/priority, agreement, fee), auction, circle detail
  (timeline, my payments, pay / pay ahead), on-device draw verification, payments + receipts,
  profile (tier, on-time rate, language, Arabic-Indic numerals, Hijri dates, biometric lock,
  delete account), support (FAQ, WhatsApp/call, ticket), notifications.
- Face ID / fingerprint lock on open and before every payment or bid. Tokens in the keychain.
- Offline: the last data is cached and shown with an offline banner.
- `pnpm --filter @sanad/mobile web` opens a browser preview (developer convenience only).
- Tests: `pnpm --filter @sanad/mobile test` (Vitest for logic, Jest + RNTL for screens).
  E2E flows for Maestro live in `apps/mobile/.maestro` (see `config.yaml`).

## API (apps/api)

NestJS + PostgreSQL (Drizzle ORM) + BullMQ/Redis. Interactive docs at
http://localhost:3000/docs once it runs.

```bash
pnpm infra:up                               # Postgres, Redis, Mailpit (Docker Desktop)
pnpm --filter @sanad/api db:migrate         # create tables
pnpm --filter @sanad/api db:seed            # demo members, circles in every state, §5.14 examples
pnpm dev:api                                # http://localhost:3000
```

The seed prints a demo admin login (email, password, TOTP secret for an authenticator app).
Demo members use phones `+96550000001…`; request an OTP, then read it at
`GET /dev/sms?phone=%2B96550000001` (dev only).

Trying a circle end to end without waiting months (dev only):

- `POST /payments/dev/{paymentId}/confirm` — confirm a mock payment as the gateway would.
- `POST /dev/clock?at=2027-03-10T10:00:00%2B03:00` — move the API clock; `?reset=true` to undo.
- `POST /dev/tick` — run the scheduler now (payouts, defaults, reminders, closing…).

All payment, identity, SMS and push providers are mocks. Nothing moves real money.

Tests: `pnpm --filter @sanad/api test` runs the full lifecycle for every worked example against
a throw-away Postgres database (skipped with a warning when Postgres is not running).

## Financial engine (packages/core)

Every money rule lives here as pure functions, tested against the spec's worked examples (§5.14)
and 300 random circles per test run (property tests). Main entry points:

- `applyCircleEvent(state, event, config)` — the circle lifecycle reducer (FORMING → CLOSED).
- `Ledger` — double-entry ledger with idempotency keys and a guard that stops the Guarantee
  Fund paying for anything except advances, refunds and revenue release.
- `placeBid` / `publicView` — priority auction; `runDraw` / `verifyDraw` — provably fair draw.
- `computeTier`, `joinBlockers`, `minimumReserve`, `nextBreakerState` — risk controls.
- `simulate` — Monte Carlo of a pool of circles (`pnpm simulate`).

```bash
pnpm simulate -- --sanity --post-default 0.1   # expect ≈ 450 KWD loss per circle
pnpm simulate -- --runs 500 --circles 36 --post-default 0.03 --recovery 0.3
PROPERTY_RUNS=3000 pnpm --filter @sanad/core test   # heavier property test run
```

## Build phases

| Phase | Scope                                                   | Status  |
| ----- | ------------------------------------------------------- | ------- |
| 0     | Monorepo, tooling, Docker Compose, CI, empty apps       | ✅ Done |
| 1     | Core financial engine + config + ledger + simulation    | ✅ Done |
| 2     | API (auth, KYC mock, circles, auction, draw, payments…) | Next    |
| 3     | Mobile app screens (ar + en)                            |         |
| 4     | Admin dashboard                                         |         |
| 5     | Contracts, PDFs, legal case files                       |         |
| 6     | Hardening, store builds                                 |         |
| 7     | Real integrations — **only after written go-ahead**     |         |

## Golden rules

1. Money is integer **fils** (`bigint`). Never floats. Display with 3 decimals.
2. Business numbers live in versioned config, never hard-coded.
3. Every financial rule lives in `packages/core` with tests.
4. Arabic first, full RTL.
5. Items tagged `[LEGAL]`, `[SHARIAH]` or `[DECISION NEEDED]` stay configurable until the founder
   decides.
