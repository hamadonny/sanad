/**
 * Monte Carlo simulation CLI (organiser model, D-017).
 *
 *   pnpm --filter @sanad/core simulate                       # default mix
 *   pnpm --filter @sanad/core simulate -- --sanity           # d × 3,900 KWD shortfall check
 *   pnpm --filter @sanad/core simulate -- --runs 500 --circles 36 --post-default 0.03 \
 *        --pre-default 0.01 --late 0.05 --recovery 0.3 --bid-rate 0.6 \
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
  console.log(
    `Sanad Monte Carlo — ${s.runs} runs × ${s.circlesPerRun} circles (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
  console.log(`  mean Sanad revenue per circle      ${s.meanRevenuePerCircleKwd.toFixed(3)} KWD`);
  console.log(`  mean member shortfall per circle   ${s.meanShortfallPerCircleKwd.toFixed(3)} KWD`);
  console.log(`  shortfall as share of payouts      ${s.shortfallShareOfPayoutsPct.toFixed(2)}%`);
  console.log(
    `  circles with any shortfall         ${(s.probabilityCircleHasShortfall * 100).toFixed(1)}%`,
  );
  if (values.sanity) {
    const d = params.postPayoutDefaultRate as number;
    console.log(`  sanity: expected ≈ d × 3,900 = ${(d * 3_900).toFixed(1)} KWD`);
  }
}
