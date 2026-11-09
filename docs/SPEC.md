# Sanad — Digital Jamiya App

## Product & Technical Specification for Claude Code

> **Superseded in part by D-017 (2026-11-09, see DECISIONS.md).** Sanad is an *organiser*, not a
> guarantor: there is no Guarantee Fund, entry-fee refunds, fund advances, minimum reserve or
> circuit breaker. Members pay a one-time 3% organising fee; payouts are what was collected for the
> month (minus bid and holdback), late money is forwarded as a top-up, and defaults are handled by
> holdback spreading, vacancy redistribution and legal recovery (10% recovery fee). Where this spec
> and D-017 disagree, D-017 wins.

---

## 0. Instructions for Claude Code (read first)

You are building a production-quality mobile app (iOS + Android) with a backend and an admin dashboard for a **digital jamiya** (rotating savings group, ROSCA) platform launching in **Kuwait**.

Working rules:

1. **Work in phases** (Section 18). At the end of each phase: stop, summarize what was built, list how to run it, list open questions, and wait for my approval before starting the next phase.
2. **Financial correctness is the #1 priority.** Every rule in Section 5 must be implemented in a pure, framework-free core package and covered by unit tests, including the worked examples in Section 5.14 as test fixtures.
3. **Never move real money or verify real identities.** All payment, identity, SMS and e-signature integrations must sit behind interfaces with **mock implementations** first. Real providers are added only in Phase 7, after I confirm licensing.
4. **Never hard-code business numbers.** Fees, refund tiers, bid minimums, grace periods, caps and thresholds live in a versioned config (Section 5.13). Use the defaults given here.
5. **Money is always integer fils** (1 KWD = 1,000 fils). Never use floating point for money. Display with 3 decimals (e.g. `100.000 KWD`).
6. When something is ambiguous, **ask instead of guessing**. Items tagged `[DECISION NEEDED]`, `[LEGAL]` or `[SHARIAH]` must not be finalized by you; build them configurable and flag them.
7. Arabic is the **default language** with full RTL support; English is secondary.
8. Write clean, typed, documented code. Prefer boring, proven libraries.

---

## 1. Product Summary

A jamiya is a group of N people who each pay a fixed amount every month for N months; each month one member receives the whole pot. Traditional jamiyas fail because members don't trust strangers, can't find groups, and early receivers sometimes stop paying.

Sanad solves this by:

- **Matching verified strangers** into circles by monthly amount.
- **Guaranteeing every payout** through a pooled Guarantee Fund financed by an upfront entry fee (one month's contribution).
- **Selling priority spots** (spots 1–3) via auction to members who need money urgently.
- **Rewarding patience**: members in late spots get their entry fee back (fully or partially) when they complete the circle.
- **Random, provably fair assignment** of all non-priority spots.
- **Strong enforcement**: real ID verification (Kuwait Civil ID), signed legal contract, permanent ban, and an exportable legal case file for court action against defaulters.

Example: 10 members × 100 KWD/month × 10 months → each month one member receives 1,000 KWD.

---

## 2. Glossary

| Term                  | Meaning                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Circle**            | One jamiya group. Has N members and lasts N months.                                                                                                                               |
| **N**                 | Number of members = number of months (MVP default: 10).                                                                                                                           |
| **M**                 | Monthly contribution per member (e.g. 100 KWD).                                                                                                                                   |
| **Pot**               | N × M, paid to one member per month.                                                                                                                                              |
| **Spot**              | A member's payout month (1..N). Spot 1 receives in month 1.                                                                                                                       |
| **Entry fee**         | One-time payment equal to M, paid when joining. Goes to the Guarantee Fund. Named "service/membership fee" in all user-facing text `[SHARIAH]` — never call it a "guarantee fee". |
| **Guarantee Fund**    | Pooled reserve (across all circles) that covers missed contributions so payouts are always on time.                                                                               |
| **Priority spot**     | Spots 1..P (default P = 3) that can be won by auction.                                                                                                                            |
| **Priority bid**      | Amount a member pays (deducted from their payout) to win a priority spot.                                                                                                         |
| **Random draw**       | Provably fair assignment of all spots not won by auction.                                                                                                                         |
| **Completion refund** | Return of all or part of the entry fee to late-spot members who complete the circle in good standing.                                                                             |
| **Holdback**          | Part of an early payout held until the member finishes paying (risk control for new users).                                                                                       |
| **Exposure**          | Sum of contributions still owed by members who have already received their payout.                                                                                                |
| **Trust tier**        | Member reliability level controlling what they can do.                                                                                                                            |
| **Default**           | Contribution unpaid past the default threshold.                                                                                                                                   |

---

## 3. Users & Roles

- **Member** — end user on the mobile app.
- **Admin roles** (admin dashboard, role-based access):
  - `super_admin` — everything, including config changes.
  - `ops` — circles, payments, members, support.
  - `kyc_reviewer` — identity verification queue.
  - `finance` — ledger, fund, revenue, refunds, reports (read + approve).
  - `legal` — defaults, legal case files.
  - `viewer` — read-only.
- All admin actions are written to an immutable audit log.

---

## 4. Circle Lifecycle

States:

```
FORMING → AUCTION → DRAWING → ACTIVE → CLOSING → CLOSED
    ↘ CANCELLED (only from FORMING or AUCTION)
```

1. **FORMING** — Members join a queue for a given M (and N). Each pays the entry fee on joining (held; fully refundable if they leave or the circle is cancelled before AUCTION). When N members are in, the circle moves to AUCTION.
2. **AUCTION** — Window of `auctionDurationHours` (default 48h). Eligible members may bid on priority spots. Server publishes the draw commitment hash (Section 5.7) at the start of this state.
3. **DRAWING** — Auction results are locked; remaining spots are assigned by the provably fair draw; the seed is revealed; members are notified of their spot and the full schedule. Contract is finalized with the member's spot.
4. **ACTIVE** — Monthly cycle: contributions due → grace period → payout. The Guarantee Fund covers any shortfall so payouts are never late.
5. **CLOSING** — After month N's payout: settle holdbacks, completion refunds, defaulter refunds, revenue release.
6. **CLOSED** — Read-only. Member trust profiles updated.
7. **CANCELLED** — If FORMING doesn't fill within `formingTimeoutDays` (default 14) → full entry fee refunds.

---

## 5. Financial Rules (Core Engine)

All of Section 5 is implemented in `packages/core` as pure functions with no I/O.

### 5.1 Money

- Store and compute in integer **fils** (`bigint` or safe integer; pick one and be consistent).
- Rounding: any percentage calculation rounds **down** to the nearest fils; the remainder stays in the Guarantee Fund. Document every rounding point.

### 5.2 Circle parameters

- Allowed monthly amounts M (config): `50, 100, 250, 500` KWD.
- N (config): MVP fixed at `10`. Engine must support any N from 4 to 24.
- P (priority spots): `3`.
- Contribution due day: day `dueDayOfMonth` of each month (default: the circle's start day, max 28).

### 5.3 Entry fee

- Entry fee = **M** (one month's contribution), paid when joining the FORMING queue.
- Credited to the Guarantee Fund (tagged with the circle id in the ledger).
- Refundable in full if the member leaves during FORMING or the circle is CANCELLED.
- After DRAWING, refundable only through the completion refund rules (5.8).

### 5.4 Monthly contributions

- Every member pays M every month for N months, **including the month they receive the pot and the months after**.
- Due on the due day; `gracePeriodDays` (default 3) before marked LATE; `defaultThresholdDays` (default 15) before marked DEFAULTED.
- Payments are made in-app via the PaymentProvider. Support paying in advance.

### 5.5 Payouts

- Payout for month k goes to the member holding spot k on `dueDay + payoutOffsetDays` (default 5).
- **Payout is always made in full and on time.** Any contribution missing at payout time is covered by the Guarantee Fund (recorded as a fund advance against the late member).
- Preconditions for the receiving member: identity verified, contract signed, and their own contributions up to month k paid. If the receiver is themselves unpaid for month k, their payout is held until they pay (and the default flow applies if they never do).
- Payout amount = `Pot − priorityBid (if any) − holdback (if any)`.

### 5.6 Priority spots & auction

- Spots 1..P are auctionable. Minimum bid per spot as % of M (config): spot 1: **30%**, spot 2: **20%**, spot 3: **10%** (for M = 100 KWD → 30, 20, 10 KWD).
- Minimum increment: **5% of M**.
- Open ascending auction: members see the current highest bid amount per spot, **never the bidder's identity**.
- A member may hold a leading bid on **only one spot at a time**. Placing a bid on another spot withdraws their previous one.
- Anti-sniping: a bid in the last `antiSnipeMinutes` (default 5) extends that spot's auction by that many minutes.
- Eligibility to bid: trust tier ≥ 1 (Section 5.12). `[DECISION NEEDED]` whether tier 0 can bid at launch, when every user is tier 0 — make this a config flag `allowTier0Bidding` (default `true` at launch, with holdback applying).
- Winners pay their bid as a **deduction from their payout** (no upfront charge). Bid amounts are platform revenue, recognized at payout.
- Spots with no bids go into the random draw. If nobody bids at all, the whole circle is randomized and **no priority fees exist** for that circle.

### 5.7 Random draw (provably fair)

- At AUCTION start: server generates a 256-bit secret `seed` and publishes `commitment = SHA-256(seed)` to all circle members (visible in app).
- At DRAWING: unassigned members are shuffled onto unassigned spots using a deterministic Fisher–Yates shuffle driven by `HMAC-SHA256(seed, circleId || counter)`. Member list is sorted by member id before shuffling.
- Seed is revealed after the draw. The app has a "Verify draw" screen that recomputes the hash and shuffle on-device and shows ✓.
- Use a cryptographically secure RNG for the seed. Store seed encrypted until reveal.

### 5.8 Completion refunds (reward for patience)

Refund of the entry fee at CLOSING, only for members who **paid every contribution and were never DEFAULTED** (LATE but paid within threshold is OK, configurable `maxLatePaymentsForRefund`, default 2).

Default refund table for N = 10:

| Spots | Refund of entry fee |
| ----- | ------------------- |
| 1–5   | 0%                  |
| 6–7   | 50%                 |
| 8–10  | 100%                |

Generic default rule for other N (config can override with an explicit table): last `ceil(0.3 × N)` spots → 100%; the `ceil(0.2 × N)` spots before them → 50%; the rest → 0%.

`[SHARIAH]` This is a return of the member's own fee, never an amount larger than what they paid. The engine must enforce `refund ≤ entryFee` as an invariant.

### 5.9 Guarantee Fund & revenue recognition

- One pooled fund. Every ledger entry touching it carries a `circleId` so per-circle results can be computed.
- Inflows: entry fees, forfeited holdbacks, legal recoveries.
- Outflows: shortfall advances (covering missed contributions), completion refunds, revenue releases.
- **Revenue release at circle CLOSING:**
  `release = entryFeesCollected − completionRefunds − (lossesCovered − recoveries − forfeitedHoldbacks)`, floored at 0.
  If negative, the remainder is absorbed by the pool (the fund carries it; no revenue).
- Release is **blocked** if the fund after release would fall below `minimumReserve` (5.12). Blocked amounts stay in the fund and are retried at the next closing.
- Priority bids go straight to revenue at payout time.
- Late penalties (if enabled) go to a **charity payable** account, never to revenue `[SHARIAH]`.
- Operating costs are **never** paid from the fund. The admin dashboard must make this separation obvious.

### 5.10 Late payments & defaults

- **LATE** (after grace period): reminders escalate (push, SMS). Optional late penalty `latePenaltyPercent` (default 0%) routed to charity.
- **DEFAULTED** (after default threshold):
  - **Post-payout defaulter** (already received the pot): fund covers all their remaining contributions as they fall due; holdback (if any) forfeited to the fund; account **permanently banned**; completion refund forfeited; a **Legal Case File** is generated (Section 8). Any amount later recovered is credited back to the fund.
  - **Pre-payout defaulter** (hasn't received yet): removed from the circle; fund covers missing contributions; at their spot's month the pot is not paid out to them (it returns to the fund); at CLOSING they are refunded the contributions they paid, minus `prePayoutDefaultPenaltyPercent` (default 0%) `[LEGAL][SHARIAH]`; entry fee forfeited; account banned (config: `banOnPrePayoutDefault`, default `true`). The circle can offer the spot to a replacement (5.11).
- Every member has a running "amount owed" visible to admins.

### 5.11 Replacement members

- A spot vacated by a pre-payout defaulter can be offered to a new member until `replacementCutoffMonths` (default 2) months before that spot's payout.
- The replacement pays: entry fee **plus the full contribution history of the spot up to the current month** (months 1..current), then continues normally and receives that spot's payout.
- The original defaulter's paid contributions are still refunded at CLOSING (5.10).
- Invariant: replacement total paid in contributions = N × M by the end.

### 5.12 Risk controls

**Trust tiers** (config):

| Tier       | Requirements                                        | Max M   | Can bid                 | Holdback on spots 1..P |
| ---------- | --------------------------------------------------- | ------- | ----------------------- | ---------------------- |
| 0 New      | Verified ID + signed contract                       | 100 KWD | per `allowTier0Bidding` | 10% of pot             |
| 1 Reliable | ≥ 1 circle completed, ≤ 2 late payments, 0 defaults | 250 KWD | Yes                     | 5% of pot              |
| 2 Trusted  | ≥ 2 circles completed, 0 defaults                   | 500 KWD | Yes                     | 0%                     |
| Banned     | Any default (or admin action)                       | —       | —                       | —                      |

- Holdback is released at CLOSING if the member completed all contributions.
- A member may be in at most `maxActiveCircles` (default 2) circles at once.
- **Exposure** = Σ over members who already received their payout of (contributions still owed). Computed live.
- **Fund ratio** = Guarantee Fund balance ÷ total exposure.
- **Circuit breaker:** if fund ratio < `minFundRatio` (default 0.25) → automatically pause priority auctions and new circles with M > 100 KWD, and alert `super_admin` + `finance`. Resume automatically when ratio ≥ `resumeFundRatio` (default 0.35).
- `minimumReserve` = max(`reserveFloor` (default 5,000 KWD), `minFundRatio` × exposure).

### 5.13 Config

- Stored as versioned JSON in the database (`config_versions`), validated with a schema.
- Each circle stores the config version it was created under; **rule changes never affect running circles**.
- Only `super_admin` can publish a new config version; every change is audited with a diff.

### 5.14 Worked examples (must be test fixtures)

Setup: N = 10, M = 100 KWD, Pot = 1,000 KWD. Members A–J.
Member A (tier 1) wins spot 1 with a 45 KWD bid. Spots 2–3 have no bids. Member B (tier 0) is drawn into spot 2 (holdback 10% = 100 KWD). Everyone else is tier 1 or 2.

**Example 1 — Everyone pays**

| Item                                                   | Amount (KWD)                  |
| ------------------------------------------------------ | ----------------------------- |
| Entry fees in                                          | 1,000                         |
| Contributions in                                       | 10,000                        |
| Payout spot 1 (A): 1,000 − 45 bid                      | 955                           |
| Payout spot 2 (B): 1,000 − 100 holdback                | 900                           |
| Payouts spots 3–10                                     | 8 × 1,000 = 8,000             |
| Holdback released to B at closing                      | 100                           |
| Completion refunds (6, 7: 50 each; 8, 9, 10: 100 each) | 400                           |
| Revenue: bid                                           | 45                            |
| Revenue: release (1,000 − 400)                         | 600                           |
| **Check:** 955 + 900 + 8,000 + 100 + 400 + 45 + 600    | **11,000 = 1,000 + 10,000 ✓** |

**Example 2 — Post-payout default**
B (spot 2) receives 900 KWD in month 2 and never pays months 3–10.

- Fund covers 8 × 100 = 800. Holdback 100 forfeited to fund → net loss 700.
- Release = 1,000 − 400 − (800 − 0 − 100) = −100 → release 0; pool absorbs 100.
- Revenue for this circle = 45 (bid only). B banned; legal case file for 800 KWD owed (holdback already applied: claim = 700 KWD net, show both figures).

**Example 3 — Pre-payout default**
H (spot 8) pays months 1–4 then stops.

- Fund covers months 5, 6, 7, 9, 10 (5 × 100 = 500). Month 8 pot: 900 collected from others, not paid out → returns to fund (+900).
- Net fund effect from H's missing payments: +400, which equals H's paid contributions → refunded to H at closing (penalty 0%).
- H's entry fee forfeited; refunds now 300 (spots 6, 7, 9, 10). Release = 1,000 − 300 = 700. Revenue = 745.

**Example 4 — Replacement**
Same as Example 3, but R replaces H in month 6: R pays entry fee 100 + 600 (months 1–6), then 100 in months 7–10. R receives 1,000 in month 8. H is refunded 400 at closing. Fund ends neutral for the vacancy.

**Example 5 — No bids at all**
All spots drawn randomly. No priority revenue. Holdbacks apply to tier 0 members drawn into spots 1–3.

Also add a **property-based test**: for random circles, random default patterns and random config within allowed ranges, the ledger always balances and total money in = total money out + remaining fund balance + payables.

### 5.15 Simulation tool

Build `packages/core/scripts/simulate.ts`: Monte Carlo simulation of K circles with configurable default probabilities per spot, recovery rate, M mix and tier mix. Outputs expected revenue, losses, fund ratio over time, and the probability the fund drops below the minimum reserve. Sanity check: with N = 10, M = 100, a uniform post-payout default rate d, immediate default and 0% recovery, expected loss per circle ≈ d × 4,500 KWD.

---

## 6. Ledger (Double-Entry)

Every money movement is a ledger **transaction** made of **entries** that sum to zero. No balance is ever stored without being derivable from entries.

Accounts (all in fils):

- `gateway_clearing` — money in/out through the payment provider
- `circle_pot:{circleId}` — pass-through for monthly pots
- `guarantee_fund` — pooled (entries tagged with `circleId`)
- `entry_fees_held:{circleId}` — during FORMING only
- `holdbacks_payable`
- `refunds_payable`
- `member_receivable:{memberId}` — amounts advanced by the fund on a member's behalf
- `platform_revenue`
- `charity_payable`
- `losses` / `recoveries`

Transaction types: `ENTRY_FEE_PAID`, `ENTRY_FEE_REFUNDED`, `CONTRIBUTION_PAID`, `FUND_ADVANCE`, `PAYOUT`, `BID_REVENUE`, `HOLDBACK_HELD`, `HOLDBACK_RELEASED`, `HOLDBACK_FORFEITED`, `COMPLETION_REFUND`, `DEFAULTER_REFUND`, `REVENUE_RELEASE`, `LATE_PENALTY`, `CHARITY_TRANSFER`, `LOSS_WRITE_OFF`, `RECOVERY`.

Rules: entries are append-only; corrections are reversing transactions; every transaction has an idempotency key; all money-moving jobs are idempotent and safe to retry.

---

## 7. Identity & KYC

- Phone number + OTP sign-up.
- Identity via `IdentityProvider` interface:
  - `MockIdentityProvider` (dev).
  - `ManualReviewProvider`: Civil ID front/back photo + selfie → admin review queue.
  - `KuwaitMobileIdProvider` — placeholder only, implemented in Phase 7 `[LEGAL]`.
- Store: full name (Arabic + English), Civil ID number (encrypted), nationality, date of birth, Civil ID expiry, address, employer (optional), monthly income band (optional).
- Expired Civil ID blocks joining new circles.
- One account per Civil ID number. Duplicate detection on Civil ID and phone.

---

## 8. Contracts & Enforcement

- Before paying the entry fee, the member reviews and e-signs the membership contract (Arabic primary, English translation) `[LEGAL]`. Contract text is loaded from config/CMS, never hard-coded.
- After DRAWING, an addendum with the member's spot, payout date and full payment schedule is generated and acknowledged.
- Store: contract version, signed PDF, timestamp, device info, IP, OTP confirmation reference, hash of the document.
- **Legal Case File** (generated on post-payout default, downloadable by `legal` role as PDF + ZIP): member identity data, signed contract and addendum, full payment schedule vs. actual payments, payout proof, reminder/notification log, amount owed, holdback applied, current recovery status.
- Case status tracking: `OPEN → SENT_TO_LAWYER → FILED → JUDGMENT → RECOVERING → CLOSED`, with recovered amounts posted as `RECOVERY` ledger transactions.

---

## 9. Mobile App (iOS & Android)

### 9.1 Screens

**Onboarding**

1. Language select (Arabic default) → welcome slides explaining jamiya, the guarantee, priority spots, and patience refunds.
2. Phone + OTP.
3. Identity verification (Civil ID + selfie).
4. Profile basics.
5. Notification permission.

**Home**

- Active circles as cards: monthly amount, current month, my spot, next due date + amount, "Pay now".
- Banner: "Every payout is guaranteed" with a short explainer.
- Upcoming payout highlight when the member's month is near.

**Join a circle**

- Choose monthly amount (only amounts allowed by tier; locked ones show the requirement).
- Show a clear calculator: what I pay in total, what I receive, entry fee, possible refund by spot, priority option.
- Choose: "Random spot" or "I want a priority spot" (explains auction and minimum bids).
- Review and sign contract → pay entry fee → join queue, show "x of N members joined".

**Auction**

- Per priority spot: current highest bid, minimum next bid, time left, my status (leading / outbid).
- Clear cost preview: "If you win spot 1 at 45 KWD you will receive 955 KWD in month 1."
- Confirmation sheet before each bid.

**Circle detail**

- Month-by-month timeline 1..N with who receives each month (first name + last initial only), status (paid out / upcoming).
- My payments table.
- Draw verification ("Verify fairness") screen.
- Contract and addendum view/download.

**Payments**

- Pay now, pay ahead, payment history, receipts (PDF).

**Profile**

- Trust tier, progress to next tier, completed circles, on-time rate.
- Language, notifications, support, legal docs, delete account (blocked while in an active circle; explain why).

**Support**

- FAQ, in-app ticket form, WhatsApp/call link (config).

### 9.2 UX requirements

- Full RTL layout in Arabic; mirrored icons where appropriate; Arabic-Indic numerals optional via setting.
- Every money action shows a confirmation with exact amounts in KWD (3 decimals).
- Clear empty, loading and error states. Offline-friendly read of circles and schedules.
- Accessibility: dynamic type, screen reader labels, contrast AA.
- Biometric unlock (Face ID / fingerprint) for app open and payment confirmation.

---

## 10. Admin Dashboard (Web)

- **Overview:** active circles, members, monthly volume, **Guarantee Fund balance, total exposure, fund ratio** (with circuit breaker status), defaults this month, revenue (released vs pending).
- **KYC queue:** approve/reject with reason.
- **Circles:** list/filter by state; detail with members, spots, auction history, draw proof, schedule, ledger view.
- **Members:** profile, KYC, tier, circles, payment history, owed amounts, ban/unban (with reason, audited).
- **Payments & payouts:** today's due, late, defaulted; scheduled payouts; manual retry.
- **Defaults & legal:** case list, case file generator, status updates, recoveries.
- **Finance:** ledger explorer, account balances, revenue release report, charity payable, CSV/Excel export.
- **Config:** versioned config editor with validation and diff preview (super_admin only).
- **Content:** contract versions, FAQ, notification templates (Arabic + English).
- **Audit log.**

---

## 11. Notifications

Channels: push (primary), SMS (critical), email (optional). Templates in Arabic + English, editable in admin.

Events: OTP; KYC result; circle filled; auction started / outbid / ending soon / won; draw complete (your spot is X); payment due in 3 days / due today / late / final warning before default; payout sent; holdback released; refund sent; circle closed; tier upgraded; account banned.

---

## 12. Tech Stack & Architecture

**Monorepo** (pnpm workspaces + Turborepo):

```
apps/
  mobile/     Expo (React Native) + TypeScript, Expo Router
  api/        NestJS + TypeScript
  admin/      Next.js + TypeScript
packages/
  core/       Pure financial engine (no I/O), shared domain types, simulation script
  config/     Config schema + defaults
  i18n/       Shared translation keys (ar, en)
  ui-tokens/  Colors, spacing, typography shared by mobile + admin
```

- **Mobile:** Expo SDK (latest stable), Expo Router, TanStack Query, Zustand, react-hook-form + zod, i18next with RTL, expo-secure-store, expo-local-authentication, expo-notifications, EAS Build for iOS/Android.
- **API:** NestJS, PostgreSQL, Prisma, BullMQ + Redis for scheduled jobs (due reminders, grace/default checks, payouts, auction close, draw, closing), OpenAPI spec generated and used to create a typed client for mobile/admin.
- **Admin:** Next.js App Router, server-side auth, role-based access.
- **Auth:** phone OTP → short-lived access token + rotating refresh token; admin uses separate auth with mandatory 2FA.
- **Provider interfaces** (each with a mock): `PaymentProvider` (charge, refund, payout, webhook verification), `IdentityProvider`, `SmsProvider`, `PushProvider`, `StorageProvider` (documents), `PdfGenerator`.
- **Local dev:** Docker Compose (Postgres, Redis, Mailpit), seed script creating demo users, circles in every state, and the Section 5.14 scenarios.
- **Hosting:** `[DECISION NEEDED][LEGAL]` — data residency requirements for Kuwaiti financial data. Keep infra provider-agnostic (containerized).
- **Time:** all scheduling in `Asia/Kuwait` timezone; store timestamps in UTC.

---

## 13. Data Model (minimum)

`users`, `kyc_verifications`, `trust_profiles`, `devices`, `config_versions`, `circles`, `circle_members` (spot, tier at join, holdback %, status), `auction_bids`, `draws` (commitment, encrypted seed, revealed seed, result), `installments` (member, month, amount, due date, status), `payments`, `payouts`, `refunds`, `holdbacks`, `ledger_transactions`, `ledger_entries`, `ledger_accounts`, `defaults`, `legal_cases`, `legal_case_events`, `contracts`, `contract_signatures`, `notifications`, `notification_templates`, `support_tickets`, `audit_logs`, `admin_users`.

Use database constraints (unique spot per circle, one active bid per member per circle, one account per Civil ID) in addition to application checks.

---

## 14. API Outline

```
POST   /auth/otp/request | /auth/otp/verify | /auth/refresh
GET    /me | PATCH /me
POST   /kyc/submissions | GET /kyc/status
GET    /circles/options                 # amounts/durations available to me
POST   /circles/queue                   # join queue (after contract + entry fee)
DELETE /circles/queue/:id               # leave during FORMING (refund)
GET    /circles | GET /circles/:id
GET    /circles/:id/auction | POST /circles/:id/auction/bids
GET    /circles/:id/draw                # commitment, seed (after reveal), result
GET    /circles/:id/schedule
POST   /payments/intents | POST /payments/webhook
GET    /payments | GET /payments/:id/receipt
GET    /contracts/current | POST /contracts/sign
GET    /notifications | POST /devices
Admin: /admin/* mirrors Section 10
```

---

## 15. Security & Privacy

- Encrypt sensitive fields at rest (Civil ID number, documents); TLS everywhere.
- Never put personal data in URLs, logs or analytics events.
- Members never see other members' phone numbers, IDs or full surnames.
- Rate limiting on OTP, login, bids, payments.
- Idempotency keys on every money endpoint and job.
- Webhook signature verification for payment provider.
- Role-based access + audit log for every admin read of identity documents.
- Secrets via environment/secret manager, never committed.
- Data retention policy configurable `[LEGAL]`.

---

## 16. Localization

- Arabic (default) and English; all strings via i18n keys, no hard-coded text.
- Kuwaiti-friendly Arabic tone (clear Modern Standard Arabic for legal text).
- KWD formatting with 3 decimals; dates in Gregorian with optional Hijri display.

---

## 17. Testing Requirements

- `packages/core`: ≥ 95% coverage; all Section 5.14 examples as fixtures; property-based tests for ledger balance and invariants (`refund ≤ entryFee`, payouts always full, fund never pays operating costs).
- API: integration tests for the full lifecycle (FORMING → CLOSED) for each worked example, using mock providers and a test database; job idempotency tests (run each job twice, same result).
- Mobile: component tests for money-display screens; E2E (Maestro or Detox) for onboarding → join → bid → pay → receive.
- Admin: tests for config validation and role permissions.
- CI (GitHub Actions): lint, typecheck, test, build on every push.

---

## 18. Phased Build Plan

Stop after each phase for review.

- **Phase 0 — Foundation:** monorepo, tooling (ESLint, Prettier, TypeScript strict), Docker Compose, CI, empty apps running, README with run instructions.
- **Phase 1 — Core engine:** all of Section 5 in `packages/core`, config schema, ledger model, worked-example fixtures, property tests, simulation script.
- **Phase 2 — API:** auth, users, KYC (mock + manual review), circles + queue + auction + draw, installments, payments (mock), payouts, ledger persistence, scheduled jobs, defaults, closing, notifications (mock), seed data.
- **Phase 3 — Mobile app:** all Section 9 screens in Arabic + English, connected to the API, biometric lock, push notifications.
- **Phase 4 — Admin dashboard:** all Section 10 features.
- **Phase 5 — Contracts & legal:** e-signature flow, PDF generation, legal case files, receipts.
- **Phase 6 — Hardening:** security review, performance, accessibility, error monitoring, analytics (privacy-safe), App Store / Play Store build configuration and store listing assets in Arabic + English.
- **Phase 7 — Real integrations (only after my written go-ahead):** licensed Kuwaiti payment gateway, Kuwait Mobile ID / official identity verification, SMS provider, production hosting.

---

## 19. Open Items (owner: founder, not Claude Code)

These must be resolved before handling real money. Build everything configurable so answers can be plugged in.

- `[LEGAL]` Central Bank of Kuwait licensing path (e.g. the CBK regulatory sandbox) and whether the Guarantee Fund must be held in escrow at a bank/licensed provider.
- `[LEGAL]` Membership contract, enforceability of e-signatures, default penalties, data residency and retention, debt recovery process.
- `[SHARIAH]` Review of: entry fee naming and structure, completion refunds, priority bids, holdbacks, late penalties (charity), defaulter refunds.
- `[DECISION NEEDED]` App name, brand, colors.
- `[DECISION NEEDED]` Payment gateway choice and fee rates.
- `[DECISION NEEDED]` Identity provider (Kuwait Mobile ID integration agreement).
- `[DECISION NEEDED]` Hosting provider and region.
- App Store / Google Play: financial apps must be published under a registered company developer account; prepare commercial registration documents.
