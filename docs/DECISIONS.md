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
