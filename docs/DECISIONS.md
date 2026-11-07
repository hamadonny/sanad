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
