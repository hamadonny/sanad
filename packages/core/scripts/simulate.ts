/**
 * Monte Carlo simulation CLI (spec §5.15).
 *
 *   pnpm --filter @sanad/core simulate                       # default mix
 *   pnpm --filter @sanad/core simulate -- --sanity           # d × 4,500 KWD check
 *   pnpm --filter @sanad/core simulate -- --runs 500 --circles 36 --post-default 0.03 \
 *        --pre-default 0.01 --late 0.05 --recovery 0.3 --bid-rate 0.6 --initial-fund 10000 \
 *        --mix 50:2,100:4,250:1 --tiers 6,3,1 --json
 */
import { parseArgs } from 'node:util';
import { defaultConfig } from '@sanad/config';
import { defaultSimulationParams, simulate, type SimulationParams } from '../src/simulation.js';

const { values } = parseArgs({
  options: {
    runs: { type: 'string' },
    circles: { type: 'string' },
    'start-every': { type: 'string' },
    'post-default': { type: 'string' },
    'pre-default': { type: 'string' },
    late: { type: 'string' },
    recovery: { type: 'string' },
    'bid-rate': { type: 'string' },
    'initial-fund': { type: 'string' },
    mix: { type: 'string' },
    tiers: { type: 'string' },
    seed: { type: 'string' },
    sanity: { type: 'boolean' },
    json: { type: 'boolean' },
  },
});

const num = (v: string | undefined, fallback: number): number =>
  v === undefined ? fallback : Number(v);
const base = defaultSimulationParams(defaultConfig);

const params: SimulationParams = values.sanity
  ? {
      ...base,
      runs: num(values.runs, 300),
      circles: num(values.circles, 10),
      monthlyMix: { 100: 1 },
      tierMix: [0, 0, 1],
      postPayoutDefaultRate: num(values['post-default'], 0.1),
      prePayoutDefaultRate: 0,
      latePaymentRate: 0,
      recoveryRate: 0,
      bidRate: 0,
      initialFundKwd: 1_000_000,
    }
  : {
      ...base,
      runs: num(values.runs, base.runs),
      circles: num(values.circles, base.circles),
      startEveryMonths: num(values['start-every'], base.startEveryMonths),
      postPayoutDefaultRate: num(values['post-default'], base.postPayoutDefaultRate as number),
      prePayoutDefaultRate: num(values['pre-default'], base.prePayoutDefaultRate),
      latePaymentRate: num(values.late, base.latePaymentRate),
      recoveryRate: num(values.recovery, base.recoveryRate),
      bidRate: num(values['bid-rate'], base.bidRate),
      initialFundKwd: num(values['initial-fund'], base.initialFundKwd),
      seed: num(values.seed, base.seed),
      monthlyMix: values.mix
        ? Object.fromEntries(
            values.mix.split(',').map((p) => p.split(':').map(Number) as [number, number]),
          )
        : base.monthlyMix,
      tierMix: values.tiers
        ? (values.tiers.split(',').map(Number) as [number, number, number])
        : base.tierMix,
    };

const started = Date.now();
const s = simulate(params);

if (values.json) {
  console.log(JSON.stringify({ params: { ...params, config: undefined }, summary: s }, null, 2));
} else {
  const pct = (x: number | null) => (x === null ? '   ∞' : `${x.toFixed(0).padStart(4)}%`);
  console.log(
    `Sanad Monte Carlo — ${s.runs} runs × ${s.circlesPerRun} circles (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
  console.log(`  mean revenue per circle   ${s.meanRevenuePerCircleKwd.toFixed(3)} KWD`);
  console.log(`  mean loss per circle      ${s.meanLossPerCircleKwd.toFixed(3)} KWD`);
  console.log(`  P(fund < min reserve)     ${(s.probabilityFundBelowReserve * 100).toFixed(1)}%`);
  console.log(`  breaker tripped (months)  ${s.meanBreakerTrippedMonths.toFixed(1)} per run`);
  if (values.sanity) {
    const d = params.postPayoutDefaultRate as number;
    console.log(`  sanity: expected ≈ d × 4,500 = ${(d * 4_500).toFixed(1)} KWD`);
  }
  console.log('  fund ratio over time (median / p5):');
  const step = Math.max(1, Math.floor(s.fundRatioOverTime.length / 12));
  for (const r of s.fundRatioOverTime.filter((_, i) => i % step === 0)) {
    console.log(`    month ${String(r.month).padStart(3)}  ${pct(r.medianPct)}  ${pct(r.p5Pct)}`);
  }
}
