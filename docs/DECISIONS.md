# Engineering decisions

Short records of technical choices. Business/legal/Shariah items are tracked in
[SPEC.md §19](./SPEC.md) and are **not** decided here.

## D-001 — Money is `bigint` fils (Phase 0)

- All amounts are integer fils (1 KWD = 1,000 fils) held as native `bigint`.
- Why: mixing `bigint` and `number` is a compile error and a runtime `TypeError`, so float money
  cannot sneak in. Postgres `BIGINT` ↔ Prisma `BigInt` map directly.
- Percentages are basis points (`bigint`, 10,000 = 100%). Percentage maths rounds **down**
  (`bpsOf`); the dropped sub-fils stays in the Guarantee Fund.
- Over the API, amounts travel as **strings of fils** (e.g. `"955000"`), since JSON has no bigint.
- Display: `formatKwd()` → always 3 decimals (`955.000`).

## D-002 — Toolchain versions (Phase 0)

| Tool       | Version                          | Note                                                                                          |
| ---------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Node       | 22 LTS                           | `.nvmrc`                                                                                      |
| pnpm       | 10.28                            | `packageManager` field; `node-linker=hoisted` for React Native                                |
| TypeScript | 6.0                              | TS 7 (native) is out, but typescript-eslint and Nest CLI support stops at 6.0 — boring choice |
| Expo SDK   | 58 (RN 0.88, React 19.3.0)       | React pinned to `19.3.0` repo-wide so mobile and admin share one copy                         |
| Next.js    | 16                               | App Router                                                                                    |
| NestJS     | 12                               | Native ESM                                                                                    |
| Tests      | Vitest 5                         | API tests use SWC for decorator metadata                                                      |
| Lint       | ESLint 10 flat config + Prettier | `parseFloat` banned to discourage float money                                                 |

## D-003 — Shared packages are built (Phase 0)

`packages/*` compile to `dist/` (ESM + `.d.ts`). Apps consume the built output, so the same code
runs in Node (API), Next.js and Metro without per-bundler TS hacks. Turborepo builds dependencies
first (`dependsOn: ["^build"]`).

## D-004 — Arabic is default regardless of device language (Phase 0)

The mobile app starts in Arabic (RTL) even on an English device; the user switches in onboarding
or settings. Full `I18nManager.forceRTL` + reload handling lands in Phase 3.

## D-005 — Ledger model (Phase 1)

- Entries are signed: **debit > 0, credit < 0**; every transaction sums to zero.
- Two sides that must each balance inside every transaction:
  - **Cash** — `gateway_clearing` (all money held) vs. who it belongs to: `circle_pot:*`,
    `entry_fees_held:*`, `guarantee_fund`, `holdbacks_payable`, `refunds_payable`,
    `platform_revenue`, `charity_payable`. This makes "money in = money out + fund + payables"
    true by construction.
  - **Claims** (memo) — `member_receivable:*` and `losses` vs. `receivables_control` and
    `recoveries`. Tracks what defaulters owe without pretending it is money.
- The ledger refuses any transaction that debits `guarantee_fund` unless its type is a fund
  outflow (advance, completion/defaulter refund, revenue release, reversal) — the fund cannot
  pay operating costs.
- Transaction types added to the spec's list: `ENTRY_FEE_TRANSFERRED` (held → fund at draw),
  `FUND_ADVANCE_REPAID`, `POT_RETURNED` (vacant spot's pot → fund), `REFUND_PAID`,
  `CLAIM_CANCELLED` (pre-payout defaulter's advances become vacancy cover), `REVERSAL`.

## D-006 — Engine shape (Phase 1)

- `applyCircleEvent(state, event, config)` is a pure reducer returning
  `{ state, transactions, effects }`. Idempotency keys are deterministic
  (`{circleId}:{type}:{…}`), so re-running a job re-posts identical transactions (no-ops).
- Contributions are tracked **per spot**, not per member, so a spot that changes hands
  (replacement) still collects exactly N × M.
- Revenue release at closing = `entryFees − completionRefunds − (lossesCovered − recoveries −
forfeitedHoldbacks)`, floored at 0 — the engine also checks it equals the circle's net fund
  movement and throws if not.
- Interpretations (flagged to the founder):
  - Anti-sniping: a bid in the last 5 min moves that spot's end to **end + 5 min**.
  - Replacement allowed while `spot − monthsAlreadyPaidOut ≥ replacementCutoffMonths`
    (Example 4: spot 8, 6 months paid out → allowed).
  - Bids are capped at Pot − the bidder's holdback, so a payout can never go negative.
  - Pre-payout default penalty (0% by default) goes to charity by default (configurable).

## D-007 — Drizzle ORM instead of Prisma (Phase 2)

The spec names Prisma. Prisma's migration engine is a native binary downloaded at install time;
it could not be downloaded in the build environment and is a frequent source of Windows/CI
friction. Drizzle is pure TypeScript, SQL-first, supports everything needed here (BIGINT as
`bigint`, partial unique indexes, raw SQL triggers) and its migrator runs anywhere Node runs.
Schema: `apps/api/src/db/schema.ts`; migrations: `apps/api/migrations` (generated SQL + one
hand-written file with append-only and balance triggers).

## D-008 — Circle command pipeline (Phase 2)

- Source of truth per circle = the @sanad/core snapshot (`circles.engine_state`, bigint-safe JSON)
  plus append-only `circle_events`. Every command runs under `SELECT … FOR UPDATE` on the circle.
- Member, installment, bid and draw tables are projections, kept for queries and DB constraints
  (unique spot per circle, one active bid per member per circle).
- Ledger rows are append-only and balanced, enforced twice: in core and by Postgres triggers
  (UPDATE/DELETE forbidden; deferred trigger rejects an unbalanced transaction at COMMIT).
- Money out (payouts, refunds) is written as PENDING rows in the same transaction, then sent by
  the DisbursementService after commit, retried up to 5 times, then FAILED for manual retry.
- Payments: intent (Idempotency-Key header required) → gateway → signed webhook (HMAC) →
  SUCCEEDED → applied to the circle. If the rules reject it (e.g. the circle filled), the
  member is refunded automatically. Replayed webhooks are no-ops.
- Joining: the seat is taken when the entry fee succeeds, in the oldest FORMING circle for that
  amount and config version (`SKIP LOCKED`), or a new circle.
- The scheduler tick is idempotent (tested by running every step twice).

## D-009 — Founder said "do what you see best" for the Phase 1 questions (2026-11-07)

1. Tier holdbacks follow the spec's tier table (tier 1 = 5%); the worked-example fixtures keep
   A at tier 2 so their numbers match the spec exactly.
2. Starting reserve: new `FUND_CAPITAL` ledger type; finance/super_admin can pay company capital
   into the fund (`POST /admin/fund/capital`). Without it, releases wait for the 5,000 KWD floor.
3. Anti-sniping stays "end + 5 min".
4. Bid cap stays Pot − holdback.
5. Pre-payout default penalty (0% by default) stays routed to charity. [LEGAL][SHARIAH]
6. New config `circle.firstDueAfterDrawDays` (default 7): first due date is 7 days after the
   draw, so members are not asked to pay on the day spots are announced.

## D-010 — Typed responses shared by API and clients (Phase 3)

`packages/api-client/src/responses.ts` defines every response shape the apps use. The API's
services are annotated with these types (type-only import), so a change on either side fails
the typecheck. `SanadApi` (hand-written) adds bearer tokens, single-flight refresh on 401,
Idempotency-Key on money endpoints and typed `ApiError`s. The OpenAPI-generated `paths` stay
available for request typing and documentation.

## D-011 — Mobile architecture (Phase 3)

- Expo Router screens in `apps/mobile/src/app`; TanStack Query for server state (persisted to
  AsyncStorage for offline reads); Zustand for settings; tokens in SecureStore (keychain).
- RTL: Arabic default. Root view sets `direction`, so layout is right even where the native RTL
  flag can't change (Expo Go). Native builds also `forceRTL` and reload on language change.
  `left`/`right` always mean physical sides; logical spacing uses start/end.
- Every money action goes through one PaymentSheet: the server creates the intent first, the
  member sees the server's exact amounts (3 decimals, late penalty to charity shown
  separately), confirms with biometrics, then pays. Mock gateway until Phase 7.
- Bids show "you will receive X KWD in month N" computed from the server's pot and the
  member's holdback, before confirmation.
- Draw verification runs @sanad/core `verifyDraw` on the phone.
- API: CORS enabled for browsers in development (admin dashboard, web preview); production
  uses `CORS_ORIGINS`.
