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

## Build phases

| Phase | Scope                                                   | Status  |
| ----- | ------------------------------------------------------- | ------- |
| 0     | Monorepo, tooling, Docker Compose, CI, empty apps       | ✅ Done |
| 1     | Core financial engine + config + ledger + simulation    | Next    |
| 2     | API (auth, KYC mock, circles, auction, draw, payments…) |         |
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
