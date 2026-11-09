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

## D-012 — Brand (founder, 2026-11-08)

- Palette: Cream #fffcf2 · Stone #ccc5b9 · Olive #403d39 · Ink #252422 · Flame #eb5e28
  (tokens in `packages/ui-tokens`). AA contrast: Ink text on Flame buttons; orange text uses
  #b8461a (light) / #f39a74 (dark).
- Typeface: Readex Pro (Arabic + Latin in one family), 400/500/700, bundled in the app via
  `@expo-google-fonts/readex-pro`.
- Logo: the keystone arch (the orange keystone = the Guarantee Fund) as app icon; wordmark «سند»
  with the dot of «ن» in Flame for splash/documents. Sources in `docs/brand/` (SVG) and the
  brand board `docs/brand/brand-board.html`.
- Support contact: +965 9930 2447 (WhatsApp and phone).

## D-013 — Development sign-in while SMS is mocked (founder, 2026-11-08)

- Real SMS arrives with Phase 7, so on a phone the mock code was unreachable. In development
  (`DEV_ENDPOINTS=true`) `POST /auth/otp/request` now returns `devCode`; the app shows it and
  fills it in.
- `DEV_LOGIN_PHONES` (default `+96599302447`, the founder) sign in without any code through
  `POST /auth/dev-login`. Production forces `DEV_ENDPOINTS=false`, which empties the list and
  makes the endpoint 404 (tested).
- The API applies pending migrations on start in development (`MIGRATE_ON_START`); never in
  production, where migrations stay an explicit deploy step.
- Database outages return 503 `DATABASE_UNAVAILABLE` / `DATABASE_NOT_MIGRATED` with a
  translated message instead of a generic 500. Error logs no longer include Drizzle's query
  parameters (they can contain phone numbers).
- Phone field hint is `XXXX XXXX`: Kuwaiti mobiles start with 4, 5, 6 or 9 (validation already
  accepted all four).

## D-014 — Admin dashboard architecture (Phase 4)

- Next.js App Router with server components; no client-side data fetching. The API's admin
  token pair is stored in two httpOnly, SameSite=strict cookies; the Next server calls the API
  with it. `src/proxy.ts` refreshes the access token before it expires, with a single-flight
  guard per refresh token (the API rotates refresh tokens and revokes the family on reuse).
- Every mutation is a server action → API endpoint, so role checks and the audit log stay in
  one place (the API). The dashboard hides sections a role cannot use (`lib/nav.ts`), but the
  API is the gate. Dangerous actions (ban, capital, recoveries, config, contracts) need a
  confirmation tick.
- Viewers are read-only (API rejects non-GET) and see masked phone numbers.
- New read models live in `AdminViewsService`; admin response types in
  `@sanad/api-client/admin.ts` (D-010).
- Content: notification templates are editable except the OTP SMS (security); placeholders are
  validated against the defaults. Publishing a contract version makes every member re-sign
  before their next join [LEGAL]. FAQ moved to a `faq_items` table (seeded from the app's
  bundled FAQ, which stays as the offline fallback); the app reads `GET /content/faq`.
- Legal case file: `GET /admin/legal/cases/:id/file` returns everything spec §8 lists (identity
  read is audited); the dashboard renders a printable page. PDF + ZIP come in Phase 5.
- CSV exports (ledger, balances, revenue) are UTF-8 with BOM (Arabic in Excel) and neutralise
  spreadsheet formulas.
- Dev only: `GET /dev/admin-totp` lets the login page fill the 2FA code for demo accounts.
- Mobile RTL fix: on iOS, React Native treats `textAlign: 'left'/'right'` on Text as start/end
  inside an RTL layout, so Arabic text appeared on the left. Text now uses `textAlign: 'auto'`
  (natural = right in Arabic) on native; web keeps the physical side.

## D-015 — Contracts, e-signature and PDFs (Phase 5)

- **Placeholders until the founder uploads** [LEGAL][SHARIAH]: the contract text stays the
  placeholder (v1). The founder later (1) publishes the lawyer's final text as a new version
  (Content → Contract versions) and (2) uploads the lawyer's file and the Shariah review
  (Content → Legal & Shariah documents, `legal` role). Until then the app, the admin overview
  ("Launch readiness") and every contract PDF say the text is a placeholder and the Shariah
  review is not uploaded. Approved Shariah reviews can be downloaded by members.
- **E-signature**: agreement → SMS signing code (purpose `CONTRACT_SIGN`, separate from login
  codes in both directions) → signature row with the OTP reference, IP, device and text hash →
  signed PDF stored (encrypted) with its SHA-256. The signing SMS template cannot be edited.
- **Addendum** (after the draw): spot, payout date, holdback, bid and the full schedule; its
  hash covers all of these. The member confirms it with Face ID / fingerprint; a changed
  schedule needs a new confirmation. PDF stored on confirmation.
- **PDFs**: PDFKit with the embedded Readex Pro font. Arabic shaping comes from fontkit; we do
  the right-to-left word order ourselves (`layoutLine`, unit-tested), with Latin/number runs kept
  left-to-right and brackets mirrored. Documents are built as data (`src/pdf/documents.ts`) and
  rendered by the `PdfGenerator` provider, so a designer's template can replace the renderer.
  Arabic first, English translation after ("the Arabic text prevails").
- **Receipts**: bilingual PDF, only for paid payments; late penalties shown as going to charity.
- **Legal case file**: PDF and ZIP (PDF, JSON data, signed contract/addendum PDFs, identity
  documents). Every download is audited.
- **Fix**: the join list no longer locks amounts when the agreement is unsigned or outdated
  (signing is part of the join flow); joining itself still requires the current signature.

## D-016 — Hardening choices (Phase 6)

- Monitoring and analytics are **self-hosted** (Sanad's own database), not a third-party SDK:
  fewer data-residency questions, no trackers in the app, nothing to disclose as "shared".
  Analytics are anonymous daily counts of 14 known events; members can switch them off.
- Rate limiting is per signed-in session (per IP when signed out) because Kuwaiti carriers
  use carrier-grade NAT.
- Store review account (`REVIEW_PHONE` / `REVIEW_CODE`) is the only way to sign in without an
  SMS in production; empty by default.
- Store submission waits for Phase 7: Apple and Google reject simulated payments. Internal
  testing (TestFlight / Play internal track) is possible as soon as the developer accounts exist.
- Full findings and measurements: `docs/HARDENING.md`; store material: `docs/store/`.

## D-017 — Founding business model: organiser fee, no guarantee (founder, 2026-11-09)

Settled before launch; **never changed later, only added to** (founder's rule).

- **No guarantee.** Sanad does not cover members who stop paying. There is no Guarantee Fund,
  no fund advances, no completion refunds, no circuit breaker on a fund ratio, no revenue release.
- **Organising fee: 3% of the pot per member**, paid when joining, held until the draw (refunded
  if the member leaves while the circle is forming or the circle never fills), earned at the draw.
- **Early-spot auction kept** (spots 1–3; minimum bids 30/20/10% of the monthly amount) [SHARIAH].
- **Members' payout = what the group actually paid in for that month** (minus the recipient's bid
  and holdback). Late money is forwarded to that month's recipient when it arrives.
- **Holdback** (the member's own money, returned at the end) on spots 1–3: 30% tier 0, 25% tier 1,
  20% tier 2.
- **Post-payout default:** the defaulter's holdback is spread equally over every month they still
  owe; the rest is a shortfall borne equally by those months' recipients. Sanad pursues it legally
  for the group; recoveries are paid to the affected members, minus the recovery fee.
- **Pre-payout default (vacant spot):** the vacant spot's own pot pays its missing contributions
  to the other members, and the defaulter gets back what they paid in (minus any charity
  penalty). A replacement member can take the spot: they pay the months so far (catch-up) plus
  the replacement fee.
- **Fee schedule (D), all configurable in the dashboard:** replacement fee 3% of pot, recovery
  fee 10% of amounts recovered [SHARIAH], spot exchange 1% of pot per party, fast payout 2 KWD,
  private circle setup 5 KWD, company circles 1 KWD per employee per circle.
- Late penalties (off by default) still go to charity.
- A future optional "Protection" product may add a guarantee as an add-on.

**Engine details settled while building D-017** (packages/core `circle.ts`, property-tested over
40,000 random circles):

- A short month pays the recipient's **bid first, then their holdback, then the recipient**; later
  money for that month follows the same order and is sent as a top-up.
- A recipient who has not paid their own month is still **held** until they pay or default.
- A defaulter's holdback is split **as equally as possible** (fils remainder to the earliest
  months); any holdback beyond what they owe is refunded to them.
- A recovery reduces the defaulter's debt by the **full amount**; the members receive it minus the
  10% recovery fee.
- Money arriving for a defaulted recipient's own month pays down their debt (it is not sent to them).
- When several spots are vacant at once, money is never spent on a vacant month; anything left
  after repairing the missing months and refunding the defaulters' own payments goes back
  equally to the active members (refund kind `EXCESS_PAYMENT`).
- Refund rows are created as soon as money is due (`REFUND_DUE`), not at closing.
- Payment purpose `ENTRY_FEE` is renamed `ORGANIZING_FEE`; config `schemaVersion` is 2. Existing
  development databases must be reset.
