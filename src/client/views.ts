/**
 * Every view is a pure function: state in, HTML string out. That keeps the app
 * easy to reason about (and easy to smoke-test in Node).
 */
import {
  CHANCE_ONE,
  CHANCE_THREE,
  CHANCE_TWO,
  GAMES,
  decadeLabel,
  formatDrawDate,
  type BacktestResult,
  type Deduction,
  type EngineConfig,
  type NumberEvidence,
  type RateAudit,
} from '../mathEngine';
import {
  badge,
  ball,
  drawWhen,
  stalenessNote,
  targetHeading,
  balls,
  card,
  check,
  esc,
  num,
  pct,
  pTone,
  signed,
  stat,
  tinyPct,
  zBar,
  zTone,
  zWidth,
} from './format';
import { betTypes, coverage, linesForConfidence } from '../bets';
import {
  bestDirect1Ev,
  breakEvenShakeSeconds,
  firstBallProbability,
  mixQuality,
  mixingVerdict,
  qualityPerRelease,
} from '../mixing';
import { guessRepo, workflowUrl } from './store';
import type { AppState, View } from './types';

const TABS: Array<{ id: View; label: string; icon: string }> = [
  { id: 'deduce', label: 'Deduction', icon: '◎' },
  { id: 'lab', label: 'Draw lab', icon: '⚗' },
  { id: 'backtest', label: 'Backtester', icon: '⟲' },
  { id: 'ledger', label: 'Ledger', icon: '☰' },
  { id: 'settings', label: 'Data', icon: '⚙' },
];

/* ==========================================================================
 * Shell
 * ========================================================================== */

export function renderHeader(state: AppState): string {
  const draws = state.draws.length;
  const latest = state.draws[state.draws.length - 1];
  const next = latest ? state.deduction?.next : null;
  const modeBadge =
    state.mode === 'worker'
      ? badge('Cloudflare + D1 live', 'ok')
      : badge('GitHub Pages · static', 'info');

  return `
  <header class="border-b border-white/10 bg-gradient-to-br from-[#0b1020] via-[#0d1526] to-[#0a0f1c]">
    <div class="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <div class="flag-mark" aria-hidden="true">
          <span class="bg-[#ce1126]"></span><span class="bg-[#fcd116]"></span>
          <span class="bg-[#006b3f]"></span><span class="bg-black"></span>
        </div>
        <div>
          <h1 class="text-base font-semibold leading-tight text-slate-50 sm:text-lg">
            Ghana NLA 5/90 <span class="text-amber-300">Deduction Engine</span>
          </h1>
          <p class="text-[11px] text-slate-400">
            ${draws} draws stored · ${esc(latest ? formatDrawDate(latest.draw_date) : 'no data yet')}
            ${next ? ` · next: <span class="text-slate-300">${esc(next.label)}</span>` : ''}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        ${modeBadge}
        ${state.lastSync ? badge(`synced ${state.lastSync}`, 'muted') : ''}
        <button data-action="refresh" class="btn btn-primary" type="button"
          title="${state.mode === 'static' ? 'Static site: dispatches the GitHub Actions refresh (needs a token in the Data tab)' : 'Fetch the latest results from the source and store them in D1'}">
          <span class="text-base leading-none">↻</span> ${state.mode === 'static' ? 'Refresh via GitHub' : 'Refresh Latest Results'}
        </button>
      </div>
    </div>
    <nav class="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-1">
      ${TABS.map(
        (t) => `
        <button type="button" data-action="tab" data-tab="${t.id}"
          class="tab ${state.view === t.id ? 'tab-active' : ''}">
          <span class="opacity-70">${t.icon}</span> ${t.label}
        </button>`
      ).join('')}
    </nav>
  </header>`;
}

/* ==========================================================================
 * Controls
 * ========================================================================== */

export function renderControls(state: AppState): string {
  // Prefer the engine's normalised weights; fall back to the raw sliders
  // before the first deduction has been computed.
  const raw = state.deduction?.meta.weights ?? state.config.weights;
  const total = raw.bayes + raw.poisson + raw.markov || 1;
  const bw = Math.round((raw.bayes / total) * 100);
  const pw = Math.round((raw.poisson / total) * 100);
  const mw = 100 - bw - pw;

  return `
  <div class="sticky top-0 z-30 border-b border-white/10 bg-[#080c16]/95 backdrop-blur">
    <div class="mx-auto max-w-7xl px-4 py-3">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <label class="field">
          <span>Game</span>
          <select id="game-select">
            <option value="all"${state.game === 'all' ? ' selected' : ''}>All games (pooled)</option>
            ${GAMES.map(
              (g) =>
                `<option value="${esc(g)}"${state.game === g ? ' selected' : ''}>${esc(g)}${
                  g === todayGameLabel() ? ' — today' : ''
                }</option>`
            ).join('')}
          </select>
        </label>
        <label class="field">
          <span>Lookback <b id="lookback-val">${state.config.lookback}</b> draws</span>
          <input id="lookback" type="range" min="10" max="120" step="5" value="${state.config.lookback}" />
        </label>
        <label class="field">
          <span>Candidate pool <b id="pool-val">${state.config.poolSize}</b></span>
          <input id="pool-size" type="range" min="6" max="30" step="1" value="${state.config.poolSize}" />
        </label>
        <div class="field justify-end">
          <span>Weights (normalised)</span>
          <div class="flex gap-1 text-[11px]">
            <span class="pill text-emerald-300" id="pill-bayes">B ${bw}%</span>
            <span class="pill text-sky-300" id="pill-poisson">P ${pw}%</span>
            <span class="pill text-violet-300" id="pill-markov">M ${mw}%</span>
          </div>
        </div>
        <button type="button" data-action="toggle-advanced" class="field justify-end text-left">
          <span>Model</span>
          <span class="text-xs text-amber-300">${state.advanced ? 'Hide the maths ▲' : 'Show the maths ▼'}</span>
        </button>
        <button type="button" data-action="tab" data-tab="backtest" class="field justify-end text-left">
          <span>Validate</span>
          <span class="text-xs text-sky-300">Run walk-forward test →</span>
        </button>
      </div>

      <div class="${state.advanced ? 'mt-3 block' : 'hidden'}">
        <div class="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-3">
          <label class="field">
            <span>Pillar 1 · Bayesian weight <b id="wb-val">${Math.round(state.config.weights.bayes * 100)}%</b></span>
            <input id="w-bayes" type="range" min="0" max="100" step="5" value="${Math.round(
              state.config.weights.bayes * 100
            )}" />
          </label>
          <label class="field">
            <span>Pillar 2 · Poisson weight <b id="wp-val">${Math.round(state.config.weights.poisson * 100)}%</b></span>
            <input id="w-poisson" type="range" min="0" max="100" step="5" value="${Math.round(
              state.config.weights.poisson * 100
            )}" />
          </label>
          <label class="field">
            <span>Pillar 3 · Markov weight <b id="wm-val">${Math.round(state.config.weights.markov * 100)}%</b></span>
            <input id="w-markov" type="range" min="0" max="100" step="5" value="${Math.round(
              state.config.weights.markov * 100
            )}" />
          </label>
        </div>
        <div class="mt-3 grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="field">
            <span>Bayes prior strength (pseudo-draws)</span>
            <input id="prior" type="number" min="1" max="500" step="1" value="${state.config.bayesPriorStrength}" />
          </label>
          <label class="field">
            <span>Markov shrinkage α</span>
            <input id="alpha" type="number" min="0" max="200" step="1" value="${state.config.markovAlpha}" />
          </label>
          <label class="field">
            <span>Machine-number weight in Markov</span>
            <input id="machine" type="number" min="0" max="1" step="0.1" value="${state.config.markovMachineWeight}" />
          </label>
          <label class="field">
            <span>Expected gap λ (draws)</span>
            <input id="gap" type="number" min="2" max="90" step="1" value="${state.config.expectedGap}" />
          </label>
          <div class="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-4 pt-1">
            <label class="inline-flex items-center gap-2 text-xs text-slate-300">
              <input id="f-decade" type="checkbox" ${state.config.filters.decadeSpread ? 'checked' : ''} />
              Decade spread
            </label>
            <label class="inline-flex items-center gap-2 text-xs text-slate-300">
              <input id="f-parity" type="checkbox" ${state.config.filters.parityBalance ? 'checked' : ''} />
              Parity balance
            </label>
            <label class="inline-flex items-center gap-2 text-xs text-slate-300">
              <input id="f-sumrange" type="checkbox" ${state.config.filters.sumRange ? 'checked' : ''} />
              Sum range
            </label>
            <label class="inline-flex items-center gap-2 text-xs text-slate-300">
              min <input id="f-minsum" type="number" class="w-20" value="${state.config.filters.minSum}" />
              max <input id="f-maxsum" type="number" class="w-20" value="${state.config.filters.maxSum}" />
            </label>
            <button type="button" data-action="reset-config" class="text-xs text-slate-400 underline hover:text-slate-200">
              reset model defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
 * Deduction view
 * ========================================================================== */

function pillarRow(label: string, z: number, contribution: number): string {
  return `
    <div class="flex items-center gap-2">
      <span class="w-16 text-[10px] uppercase tracking-wide text-slate-400">${esc(label)}</span>
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div class="h-full ${zBar(z)}" style="width:${zWidth(z)}%"></div>
      </div>
      <span class="w-12 text-right text-[11px] font-medium ${zTone(z)}">${signed(z, 1)}</span>
      <span class="w-10 text-right text-[10px] text-slate-500">${signed(contribution, 1)}</span>
    </div>`;
}

function pickCard(e: NumberEvidence, rank: number, showMaths = true): string {
  const rings = ['ring-amber-400/60', 'ring-slate-300/40', 'ring-amber-700/50'];
  if (!showMaths) {
    return `
  <div class="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 shadow-lg ring-1 ${rings[rank - 1] ?? 'ring-white/10'}">
    <div class="flex items-start justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Pick ${rank}</span>
      <span class="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-slate-400">rank ${e.rank} of 90</span>
    </div>
    <div class="my-3 flex items-center justify-center"><span class="pick-ball">${e.number}</span></div>
    <p class="text-[11px] leading-snug text-slate-300">${esc(e.plain.overall)}</p>
  </div>`;
  }
  return `
  <div class="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 shadow-lg ring-1 ${rings[rank - 1] ?? 'ring-white/10'}">
    <div class="flex items-start justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Rank ${rank}</span>
      <span class="rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-medium ${zTone(e.score)}">z ${signed(e.score)}</span>
    </div>
    <div class="my-3 flex items-center justify-center">
      <span class="pick-ball">${e.number}</span>
    </div>
    <div class="space-y-1.5">
      ${pillarRow('Bayes', e.z.bayes, e.contribution.bayes)}
      ${pillarRow('Poisson', e.z.poisson, e.contribution.poisson)}
      ${pillarRow('Markov', e.z.markov, e.contribution.markov)}
    </div>
    <p class="mt-3 text-[11px] leading-snug text-slate-400">
      ${e.bayes.hits}/${e.bayes.trials} hits · gap ${e.poisson.gap} ·
      Markov ${num(e.markov.lift, 2)}× baseline
    </p>
  </div>`;
}

function justificationCard(e: NumberEvidence): string {
  return `
  <details class="group rounded-xl border border-white/10 bg-black/20 p-3" ${e.rank === 1 ? 'open' : ''}>
    <summary class="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-100">
      ${ball(e.number, 'pick', true)}
      <span>Why ${e.number}?</span>
      <span class="ml-auto text-[11px] font-normal ${zTone(e.score)}">blended z ${signed(e.score)}</span>
    </summary>
    <div class="mt-3 grid gap-3 md:grid-cols-3">
      <div class="rounded-lg bg-white/[0.03] p-2.5">
        <h4 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">1 · Bayesian posterior</h4>
        <p class="text-xs leading-relaxed text-slate-300">${esc(e.plain.bayes)}</p>
        <dl class="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-400">
          <div>Posterior <b class="text-slate-200">${pct(e.bayes.posteriorMean)}</b></div>
          <div>Lift <b class="text-slate-200">${signed((e.bayes.lift - 1) * 100, 0)}%</b></div>
          <div>P(p &gt; prior) <b class="text-slate-200">${pct(e.bayes.probHotterThanPrior)}</b></div>
          <div>Beta(${num(e.bayes.alpha, 1)}, ${num(e.bayes.beta, 1)})</div>
        </dl>
      </div>
      <div class="rounded-lg bg-white/[0.03] p-2.5">
        <h4 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">2 · Poisson / gap</h4>
        <p class="text-xs leading-relaxed text-slate-300">${esc(e.plain.poisson)}</p>
        <dl class="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-400">
          <div>Gap <b class="text-slate-200">${e.poisson.gap}</b></div>
          <div>λ <b class="text-slate-200">${num(e.poisson.expectedGap, 0)}</b></div>
          <div>z <b class="${zTone(e.poisson.z)}">${signed(e.poisson.z)}</b></div>
          <div>Tail <b class="text-slate-200">${pct(e.poisson.survival)}</b></div>
        </dl>
      </div>
      <div class="rounded-lg bg-white/[0.03] p-2.5">
        <h4 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-300">3 · Markov transition</h4>
        <p class="text-xs leading-relaxed text-slate-300">${esc(e.plain.markov)}</p>
        <dl class="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-400">
          <div>Expected <b class="text-slate-200">${num(e.markov.expectedFollow, 3)}</b></div>
          <div>Baseline <b class="text-slate-200">${num(e.markov.baseline, 3)}</b></div>
          <div>Lift <b class="text-slate-200">${num(e.markov.lift, 2)}×</b></div>
          <div>z <b class="${zTone(e.z.markov)}">${signed(e.z.markov)}</b></div>
        </dl>
      </div>
    </div>
    <p class="mt-2 rounded-lg bg-amber-400/5 px-2.5 py-2 text-xs leading-relaxed text-amber-100/90">
      ${esc(e.plain.overall)}
    </p>
  </details>`;
}

function auditCard(d: Deduction): string {
  const a = d.trio.audit;
  const sumPos = Math.max(0, Math.min(100, ((a.sum - 30) / (270 - 30)) * 100));
  const minPos = ((d.evidence.length && 75 - 30) / 240) * 100;

  return card(`
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-100">Combinatorial audit</h2>
      ${a.pass ? badge('PASS — all filters satisfied', 'ok') : badge('FAILED — filter relaxed', 'bad')}
    </div>
    <div class="mt-3 flex items-center justify-between gap-2">
      <div class="flex gap-2">${balls(a.numbers, 'pick')}</div>
      <div class="text-right">
        <div class="text-[10px] uppercase tracking-wide text-slate-400">Composite</div>
        <div class="text-sm font-semibold ${zTone(d.trio.score)}">${signed(d.trio.score)}</div>
      </div>
    </div>
    <ul class="mt-2 divide-y divide-white/5">
      ${check(
        a.spreadOk,
        'Decade spread',
        `decades ${a.decades.map((x) => decadeLabel(x)).join(' · ')} (${a.distinctDecades} distinct)`
      )}
      ${check(a.parityOk, 'Parity balance', `${a.odd} odd / ${a.even} even`)}
      ${check(a.sumOk, 'Sum optimisation', `sum ${a.sum} (target 75–195)`)}
    </ul>
    <div class="mt-3">
      <div class="mb-1 flex justify-between text-[10px] text-slate-400">
        <span>sum spread</span><span>${a.sum}</span>
      </div>
      <div class="relative h-2 rounded-full bg-white/10">
        <div class="absolute inset-y-0 rounded-full bg-emerald-500/25" style="left:18.75%;right:18.75%"></div>
        <div class="absolute -top-0.5 h-3 w-1 rounded bg-amber-300" style="left:${sumPos}%"></div>
      </div>
      <div class="mt-1 flex justify-between text-[9px] text-slate-500"><span>30</span><span>target 75–195</span><span>270</span></div>
    </div>
    <div class="mt-3">
      <div class="mb-1 flex justify-between text-[10px] text-slate-400">
        <span>Spread entropy</span><span>${pct(a.entropy, 0)}</span>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-white/10">
        <div class="h-full bg-gradient-to-r from-sky-400 to-emerald-400" style="width:${Math.round(a.entropy * 100)}%"></div>
      </div>
    </div>
    ${
      a.patterns.length
        ? `<div class="mt-3 flex flex-wrap gap-1">${a.patterns
            .map((p) => badge(p, 'muted'))
            .join('')}</div>
           <p class="mt-1 text-[10px] leading-snug text-slate-500">Human-popularity flags shown for information only — NLA 5/90 pays fixed odds, so popularity does not change your prize.</p>`
        : ''
    }
    <div class="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-400">
      <div>Combos tested <b class="text-slate-200">${d.meta.testedCombos}</b></div>
      <div>Passing filters <b class="text-slate-200">${d.meta.validCombos}</b></div>
    </div>
    <span class="hidden">${minPos}</span>
  `);
}

/** The "full five-number line" — what coverage actually buys. */
function fiveLineCard(state: AppState): string {
  const d = state.deduction;
  if (!d) return '';
  const five = d.evidence.slice(0, 5).map((e) => e.number);
  const direct5 = betTypes().find((b) => b.id === 'direct5')!;
  const half = coverage({ betId: 'direct5', lines: linesForConfidence('direct5', 0.5), stakePerLine: 1 });

  return card(`
    <div class="flex flex-wrap items-start justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-100">The full five-number line</h2>
      ${badge('Direct 5', 'info')}
    </div>
    <div class="mt-2 flex flex-wrap gap-1.5">${balls(five)}</div>
    <div class="mt-3 grid gap-3 sm:grid-cols-3">
      ${stat('Chance one line wins', tinyPct(direct5.probability), `1 in ${Math.round(direct5.oneIn).toLocaleString()}`)}
      ${stat('Pays', `${direct5.multiplier.toLocaleString()}×`, 'on every unit staked')}
      ${stat('Average return', `${(direct5.ev * 100).toFixed(2)}%`, 'of everything you stake')}
    </div>
    <p class="mt-3 text-[11px] leading-relaxed text-slate-300">
      Yes — it can win. Somebody does, occasionally, and the five numbers above are as good a line as
      any other. But look at what "likely" costs: to reach a 50% chance you would need about
      <b>${Math.round(half.lines).toLocaleString()}</b> lines. At 1 unit per line that is
      <b>${Math.round(half.totalStake).toLocaleString()}</b> units staked for a prize of
      <b>${direct5.multiplier.toLocaleString()}</b> units — and the expected return on that pile is
      <b>${Math.round(half.expectedReturnValue).toLocaleString()}</b> units. Coverage multiplies the
      stake and the drama; it does not multiply the edge.
    </p>
    <p class="mt-2 text-[11px] leading-relaxed text-slate-400">
      If you are going to play at all, the Draw lab shows which ticket loses least per cedi.
      Direct 2 returns around ${Math.round(betTypes()[0].ev * 100)}%; Direct 5 returns
      ${(direct5.ev * 100).toFixed(2)}%.
    </p>
  `);
}

function metaCard(d: Deduction): string {
  return card(`
    <h2 class="text-sm font-semibold text-slate-100">Model state</h2>
    <dl class="mt-2 space-y-1.5 text-[11px]">
      <div class="flex justify-between"><dt class="text-slate-400">Window</dt>
        <dd class="text-slate-200">${esc(d.meta.windowStart)} → ${esc(d.meta.windowEnd)}</dd></div>
      <div class="flex justify-between"><dt class="text-slate-400">Draws used</dt>
        <dd class="text-slate-200">${d.meta.drawsUsed} of ${d.meta.totalDraws}</dd></div>
      <div class="flex justify-between"><dt class="text-slate-400">Weights (B/P/M)</dt>
        <dd class="text-slate-200">${Math.round(d.meta.weights.bayes * 100)}/${Math.round(
          d.meta.weights.poisson * 100
        )}/${Math.round(d.meta.weights.markov * 100)}</dd></div>
      <div class="flex justify-between"><dt class="text-slate-400">Pool / combos</dt>
        <dd class="text-slate-200">${d.meta.poolSize} → ${d.meta.testedCombos}</dd></div>
      <div class="flex justify-between"><dt class="text-slate-400">Score entropy</dt>
        <dd class="text-slate-200">${num(d.meta.scoreEntropy, 2)} bits</dd></div>
      <div class="flex justify-between"><dt class="text-slate-400">Generated</dt>
        <dd class="text-slate-200">${esc(new Date(d.meta.generatedAt).toLocaleString())}</dd></div>
    </dl>
    <p class="mt-3 border-t border-white/5 pt-2 text-[10px] leading-snug text-slate-500">
      Each pillar is standardised across all 90 numbers, so a weight of 45% always means 45% of the signal.
      High score entropy means the model is not separating candidates strongly — treat those days as noise.
    </p>
  `);
}

function alternativesCard(d: Deduction): string {
  const rows = [
    { label: 'Primary trio', t: d.trio },
    ...d.alternatives.map((t, i) => ({ label: `Alternative ${i + 1}`, t })),
  ];
  return card(`
    <h2 class="text-sm font-semibold text-slate-100">Filtered trio candidates</h2>
    <div class="mt-2 space-y-2">
      ${rows
        .map(
          (r) => `
        <div class="flex items-center justify-between rounded-lg bg-black/20 px-2 py-1.5">
          <div class="flex items-center gap-2">
            <span class="text-[10px] uppercase tracking-wide text-slate-500">${esc(r.label)}</span>
            <div class="flex gap-1">${balls(r.t.numbers, 'quiet', true)}</div>
          </div>
          <span class="text-[11px] ${zTone(r.t.score)}">${signed(r.t.score)}</span>
        </div>`
        )
        .join('')}
    </div>
    ${
      d.coverageTickets.length
        ? `<h3 class="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Full 5-number coverage lines</h3>
           <div class="mt-1.5 space-y-1.5">
             ${d.coverageTickets
               .map(
                 (t) => `<div class="flex items-center gap-1.5 rounded-lg bg-black/20 px-2 py-1.5">${balls(
                   t.numbers,
                   'win',
                   true
                 )}</div>`
               )
               .join('')}
           </div>
           <p class="mt-1.5 text-[10px] leading-snug text-slate-500">
             Optional 5-ball lines built from the same pool, chosen for diversity so they overlap as little as possible.
             Cost and expected return are unchanged — they are a convenience, not an edge.
           </p>`
        : ''
    }
  `);
}

function rankingTable(d: Deduction): string {
  const rows = d.evidence.slice(0, 24);
  return card(`
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-slate-100">Full pillar ranking <span class="text-slate-500">(top 24 of 90)</span></h2>
      <span class="text-[10px] text-slate-500">bar = blended z</span>
    </div>
    <div class="mt-2 overflow-x-auto">
      <table class="w-full min-w-[520px] text-left text-[11px]">
        <thead class="text-[10px] uppercase tracking-wide text-slate-500">
          <tr class="border-b border-white/10">
            <th class="py-1.5 pr-2">#</th><th class="py-1.5 pr-2">No</th>
            <th class="py-1.5 pr-2">Blended</th><th class="py-1.5 pr-2">Bayes</th>
            <th class="py-1.5 pr-2">Poisson</th><th class="py-1.5 pr-2">Markov</th>
            <th class="py-1.5 pr-2">Hits</th><th class="py-1.5 pr-2">Gap</th><th class="py-1.5">Mk lift</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (e) => `
            <tr class="border-b border-white/5 ${e.rank <= 3 ? 'bg-amber-400/5' : ''}">
              <td class="py-1.5 pr-2 text-slate-500">${e.rank}</td>
              <td class="py-1.5 pr-2">${ball(e.number, e.rank <= 3 ? 'pick' : 'quiet', true)}</td>
              <td class="py-1.5 pr-2">
                <div class="flex items-center gap-1.5">
                  <div class="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                    <div class="h-full ${zBar(e.score)}" style="width:${zWidth(e.score)}%"></div>
                  </div>
                  <span class="${zTone(e.score)}">${signed(e.score, 2)}</span>
                </div>
              </td>
              <td class="py-1.5 pr-2 ${zTone(e.z.bayes)}">${signed(e.z.bayes, 1)}</td>
              <td class="py-1.5 pr-2 ${zTone(e.z.poisson)}">${signed(e.z.poisson, 1)}</td>
              <td class="py-1.5 pr-2 ${zTone(e.z.markov)}">${signed(e.z.markov, 1)}</td>
              <td class="py-1.5 pr-2 text-slate-300">${e.bayes.hits}/${e.bayes.trials}</td>
              <td class="py-1.5 pr-2 ${e.poisson.overdue ? 'text-amber-300' : 'text-slate-300'}">${e.poisson.gap}${
                e.poisson.overdue ? ' ⚠' : ''
              }</td>
              <td class="py-1.5 text-slate-300">${num(e.markov.lift, 2)}×</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `);
}

/** "What the engine said last time, and what actually came out." */
/** Name of the game drawn today (UTC), for the "— today" hint in the filter. */
function todayGameLabel(): string {
  const wd = new Date().getUTCDay();
  return ['', 'Monday Special', 'Lucky Tuesday', 'Midweek', 'Fortune Thursday', 'Friday Bonanza', 'National Weekly'][wd] ?? '';
}

function renderLastDrawReview(state: AppState): string {
  const r = state.review;
  if (!r) return '';
  const actual = r.actual;
  const pickTone = (n: number): string => (actual.winning.includes(n) ? 'text-emerald-300' : '');
  const allWinning = [...actual.winning].sort((a, b) => a - b);

  return card(`
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-slate-100">Last draw vs the engine</h3>
        <p class="text-[11px] text-slate-400">
          ${esc(actual.game_name)} · ${esc(formatDrawDate(actual.draw_date))} ·
          the picks below were made from the ${r.predicted.numbers.length === 3 ? `${r.predicted.numbers.length}-number trio` : 'trio'} the engine gave *before* this draw
        </p>
      </div>
      ${badge(
        r.hits === 0 ? 'no hit' : `${r.hits} of 3 hit`,
        r.hits === 0 ? 'muted' : r.hits >= 2 ? 'ok' : 'info'
      )}
    </div>

    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <p class="text-[10px] uppercase tracking-wide text-slate-500">Drawn</p>
        <div class="mt-1 flex flex-wrap gap-1">${balls(allWinning)}</div>
        <p class="mt-1 text-[10px] text-slate-500">Machine: ${actual.machine.join(' · ')}</p>
      </div>
      <div>
        <p class="text-[10px] uppercase tracking-wide text-slate-500">Engine said</p>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          ${r.predicted.numbers
            .map(
              (n) =>
                `<span class="inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-1.5 text-xs font-semibold ${
                  pickTone(n) ||
                  'border-slate-700 bg-slate-800/80 text-slate-300'
                }">${n}</span>`
            )
            .join('')}
        </div>
        <p class="mt-1 text-[10px] text-slate-500">
          ${r.hits} hit · ${r.matchedMachine.length ? `${r.matchedMachine.length} in the machine set` : 'none in the machine set'} ·
          expected ${num(r.expectedHits)} per draw
        </p>
      </div>
    </div>

    <p class="mt-3 text-[11px] leading-relaxed text-slate-300">${esc(r.verdict)}</p>

    <details class="mt-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <summary class="cursor-pointer text-[11px] font-medium text-slate-300">
        Why these five numbers, and how surprising was the draw?
      </summary>
      <p class="mt-2 text-[11px] leading-relaxed text-slate-400">
        Rank 1 means the model rated that number most likely; a rank near 90 means it rated it
        cold. Probability of at least one hit with three picks is ${pct(r.pAtLeastOne)} per draw,
        so a blank line is the normal case — the drum does not consult the ranking.
      </p>
      <div class="mt-2 overflow-x-auto">
        <table class="w-full text-left text-[11px]">
          <thead class="text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th class="py-1 pr-3">Number</th><th class="py-1 pr-3">Pre-draw rank</th><th class="py-1 pr-3">Blended z</th><th class="py-1">Verdict</th></tr>
          </thead>
          <tbody>
            ${r.ranked
              .map(
                (x) => `<tr class="border-t border-slate-800/70">
                  <td class="py-1 pr-3 font-semibold text-slate-100">${x.number}</td>
                  <td class="py-1 pr-3 text-slate-300">${x.rank} / 90</td>
                  <td class="py-1 pr-3 ${zTone(x.z)}">${signed(x.z)}</td>
                  <td class="py-1 text-slate-400">${
                    x.hit
                      ? 'was in the engine\'s trio'
                      : x.rank <= 15
                        ? 'engine rated it highly, but it was not in the trio'
                        : x.rank >= 70
                          ? 'engine rated it cold'
                          : 'mid-table — no signal either way'
                  }</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-[10px] leading-snug text-slate-500">
        Computed with your current weights (${Math.round(r.predicted.weights.bayes * 100)}/${Math.round(
          r.predicted.weights.poisson * 100
        )}/${Math.round(r.predicted.weights.markov * 100)}) and lookback, so if you have changed
        the sliders since, this is what the engine <em>would</em> have said — not necessarily what
        your screen showed that evening.
      </p>
    </details>
  `);
}

export function renderDeduction(state: AppState): string {
  const d = state.deduction;
  if (!d) {
    return card(`
      <div class="py-10 text-center">
        <p class="text-sm text-slate-300">No deduction yet.</p>
        <p class="mt-1 text-xs text-slate-500">${
          state.draws.length === 0
            ? 'No draws found. Seed D1, import results in the Ledger tab, or trigger a refresh.'
            : 'Add at least 10 draws to enable the four-pillar engine.'
        }</p>
      </div>`);
  }

  const label = state.game === 'all' ? 'All six games pooled' : state.game;
  const todayIso = new Date().toISOString().slice(0, 10);
  const when = drawWhen(d.next.date, todayIso);
  const latest = state.draws[state.draws.length - 1];
  const stale = stalenessNote(d.next, todayIso);
  const drawnToday =
    latest && latest.draw_date === todayIso
      ? `${latest.game_name} already drawn today (${latest.winning.join(' · ')}), so these are for ${when === 'tonight' ? 'the next draw' : when}.`
      : '';

  return `
  <div class="mx-auto max-w-7xl space-y-4 px-4 py-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-lg font-semibold text-slate-50">${esc(targetHeading(d.next, todayIso))}</h2>
        <p class="text-xs text-slate-400">
          ${esc(label)} · ${d.meta.drawsUsed}-draw lookback · drawing
          <span class="text-amber-300">${esc(formatDrawDate(d.next.date))}</span> (${esc(when)})
        </p>
        ${drawnToday
          ? `<p class="mt-1 text-[11px] text-slate-500">${esc(drawnToday)}</p>`
          : ''}
        ${stale ? `<p class="mt-1 text-[11px] text-amber-400/80">${esc(stale)}</p>` : ''}
        ${state.game !== 'all' && d.meta.drawsUsed < 25
          ? `<p class="mt-1 text-[11px] text-slate-500">Only ${d.meta.drawsUsed} ${esc(
              state.game
            )} draws in the window — per-game evidence is thin, so read the scores as a small-sample opinion. Pooling all six games would use ${state.draws.length} draws.</p>`
          : ''}
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${badge(`Bayes ${Math.round(d.meta.weights.bayes * 100)}%`, 'ok')}
        ${badge(`Poisson ${Math.round(d.meta.weights.poisson * 100)}%`, 'info')}
        ${badge(`Markov ${Math.round(d.meta.weights.markov * 100)}%`, 'muted')}
      </div>
    </div>

    ${renderLastDrawReview(state)}

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="grid gap-3 sm:grid-cols-3 lg:col-span-2">
        ${d.top.map((e, i) => pickCard(e, i + 1, state.advanced)).join('')}
      </div>
      <div class="space-y-3">
        ${auditCard(d)}
        ${state.advanced ? metaCard(d) : ''}
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="lg:col-span-2 space-y-2">
        <h3 class="px-1 text-sm font-semibold text-slate-200">Plain-English justifications</h3>
        ${d.top.map((e) => justificationCard(e)).join('')}
      </div>
      <div class="space-y-3">${alternativesCard(d)}</div>
    </div>

    ${fiveLineCard(state)}

    ${state.advanced
      ? rankingTable(d)
      : `<p class="px-1 text-[11px] text-slate-500">The scoring detail — z-scores, pillar contributions, the full 90-number ranking — is hidden to keep this readable. <button type="button" data-action="toggle-advanced" class="text-amber-300 underline decoration-dotted">Show the maths</button>.</p>`}

    <div class="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-relaxed text-amber-100/80">
      <b class="text-amber-200">Read this before staking anything.</b>
      NLA 5/90 is a fixed-odds draw: the balls have no memory, so no scoring method changes the
      probability of any ticket. These three numbers are a disciplined, reproducible hypothesis —
      not a forecast. The Backtester tab measures whether the hypothesis actually beat chance on your
      own history; check it before you trust it.
    </div>
  </div>`;
}

/* ==========================================================================
 * Draw lab — what each bet returns, and whether the machine can be read
 * ========================================================================== */

export function renderLab(state: AppState): string {
  const bets = betTypes();
  const best = bets[0];
  const worst = bets[bets.length - 1];
  const maxEv = Math.max(...bets.map((b) => b.ev));

  const m = state.lab;
  const p = firstBallProbability(m);
  const ev = bestDirect1Ev(m);
  const breakEven = breakEvenShakeSeconds(m.tau);
  const qualities = qualityPerRelease(m);
  const verdict = mixingVerdict(m);
  const order = state.order;

  return `
  <div class="mx-auto max-w-7xl space-y-4 px-4 py-4">

    ${card(`
      <h2 class="text-sm font-semibold text-slate-100">The only two questions that change anything</h2>
      <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
        Which ticket loses the least money per cedi — and can the drum's timing be read? Both have
        numerical answers, so this tab gives them rather than opinions. Every figure is exact
        combinatorics or an explicit model, never a guess.
      </p>
    `)}

    ${card(`
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold text-slate-100">What each NLA bet actually returns</h2>
          <p class="text-[11px] text-slate-400">Published multiplier × exact probability. 100% = break even.</p>
        </div>
        ${badge(`best: ${best.label} at ${(best.ev * 100).toFixed(0)}%`, 'ok')}
      </div>
      <div class="mt-3 space-y-2">
        ${bets
          .map(
            (b) => `
          <div class="rounded-lg border border-white/10 bg-black/20 p-2.5">
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <span class="font-semibold text-slate-100">${esc(b.label)}</span>
              <span class="text-slate-400">${b.multiplier.toLocaleString()}× · 1 in ${Math.round(b.oneIn).toLocaleString()}</span>
              <span class="${b.ev > 0.5 ? 'text-lime-300' : b.ev > 0.1 ? 'text-amber-300' : 'text-rose-300'} font-semibold">${(b.ev * 100).toFixed(1)}%</span>
            </div>
            <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div class="h-full rounded-full ${b.ev > 0.5 ? 'bg-lime-400/70' : b.ev > 0.1 ? 'bg-amber-400/70' : 'bg-rose-400/70'}"
                   style="width:${Math.max(1, (b.ev / maxEv) * 100).toFixed(1)}%"></div>
            </div>
            <p class="mt-1 text-[10px] leading-snug text-slate-500">${esc(b.note)}</p>
          </div>`
          )
          .join('')}
      </div>
      <p class="mt-3 border-t border-white/5 pt-2 text-[11px] leading-relaxed text-slate-300">
        Every ticket is a losing proposition; the only question is how fast. ${esc(best.label)} gives
        back about <b>${(best.ev * 100).toFixed(0)}%</b> of stake, while ${esc(worst.label)} gives back
        <b>${(worst.ev * 100).toFixed(2)}%</b>. If you play, play the top line of this table and stake
        a fixed small amount.
      </p>
    `)}

    ${card(`
      <h2 class="text-sm font-semibold text-slate-100">Is the first ball biased?</h2>
      <p class="text-[11px] text-slate-400">
        Direct 1 pays only when your number is the first ball drawn, so that is the one quantity a
        timing theory would have to move. Tested on your archive, not assumed.
      </p>
      ${
        order && order.draws
          ? `
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        ${stat('Draws tested', String(order.draws), 'first ball of each draw')}
        ${stat('Chi-square', num(order.chiSquare, 1), `df = ${order.df}`)}
        ${stat('p-value', order.pValue < 0.01 ? order.pValue.toExponential(1) : num(order.pValue, 3), 'Monte-Carlo null')}
      </div>
      <p class="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5 text-[11px] leading-relaxed text-slate-200">
        ${esc(order.verdict)}
      </p>
      <div class="mt-2 grid gap-2 sm:grid-cols-2 text-[11px]">
        <div>
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Drawn first most often</p>
          <div class="mt-1 flex flex-wrap gap-1">${order.hottest
            .map((h) => `${ball(h.number, 'quiet', true)}<span class="mr-2 text-[10px] text-slate-400">${h.count}×</span>`)
            .join('')}</div>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Never / least often</p>
          <div class="mt-1 flex flex-wrap gap-1">${order.coldest
            .map((h) => `${ball(h.number, 'quiet', true)}<span class="mr-2 text-[10px] text-slate-400">${h.count}×</span>`)
            .join('')}</div>
        </div>
      </div>
      <p class="mt-2 text-[10px] leading-snug text-slate-500">${esc(order.caveat)}</p>`
          : `<p class="mt-2 text-[11px] text-slate-400">Load some draws to run the test.</p>`
      }
    `)}

    ${card(`
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold text-slate-100">Drum timing simulator</h2>
          <p class="text-[11px] text-slate-400">
            How long the drum shakes, and the pause before each button press, decide whether any
            positional bias can survive — and whether a known loading order would be worth anything.
          </p>
        </div>
        ${badge(`Direct 1 → ${ev.toFixed(2)} per 1.00`, ev >= 1 ? 'ok' : 'muted')}
      </div>

      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        <label class="field"><span>Shake before first release <b class="text-amber-300">${m.shakeSeconds.toFixed(1)}s</b></span>
          <input id="lab-shake" type="range" min="0.2" max="10" step="0.2" value="${m.shakeSeconds}" /></label>
        <label class="field"><span>Pause between button presses <b class="text-amber-300">${m.interReleaseSeconds.toFixed(0)}s</b></span>
          <input id="lab-interval" type="range" min="1" max="30" step="1" value="${m.interReleaseSeconds}" /></label>
        <label class="field"><span>Mixing time constant τ <b class="text-amber-300">${m.tau.toFixed(2)}s</b></span>
          <input id="lab-tau" type="range" min="0.2" max="2" step="0.05" value="${m.tau}" /></label>
      </div>

      <button type="button" data-action="toggle-loading-known"
        class="mt-2 w-full rounded-lg border px-3 py-2 text-left text-[11px] ${
          m.loadingKnown ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-black/20 text-slate-400'
        }">
        ${m.loadingKnown ? '☑ assuming you know which ball sits in the exit slot' : '☐ assuming a sealed drum (you do not know the loading order)'}
        <span class="block text-[10px] text-slate-500">Click to switch. Without the loading order, no timing can help you.</span>
      </button>

      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        ${stat('Mixing quality', pct(p.quality), 'share of balls displaced')}
        ${stat('Favoured first-ball chance', pct(p.favoured), `uniform would be ${pct(p.uniform)}`)}
        ${stat('Break-even shake', Number.isFinite(breakEven) ? `${breakEven.toFixed(1)}s` : '—', 'below this, Direct 1 would be beatable')}
      </div>

      <div class="mt-3 space-y-1">
        ${qualities
          .map(
            (q, i) => `
          <div class="flex items-center gap-2 text-[10px] text-slate-400">
            <span class="w-14 shrink-0">ball ${i + 1}</span>
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
              <div class="h-full rounded-full bg-sky-400/70" style="width:${(q * 100).toFixed(1)}%"></div>
            </div>
            <span class="w-10 shrink-0 text-right">${(q * 100).toFixed(0)}%</span>
          </div>`
          )
          .join('')}
      </div>
      <p class="mt-1 text-[10px] text-slate-500">
        The drum keeps mixing during the pause, so any bias can only shrink from ball 1 to ball 5 —
        which is exactly why only the first ball is worth testing.
      </p>

      <p class="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5 text-[11px] leading-relaxed text-slate-200">
        ${esc(verdict)}
      </p>
      <p class="mt-2 text-[10px] leading-snug text-slate-500">
        The model is deliberately generous: it assumes the exit slot is the only biased position and
        that displacement is all-or-nothing. Real air-mix drums mix faster than τ, the ball set is
        loaded behind a sealed door, and NLA draws at 8:30pm GMT Monday–Saturday (7:30pm Sunday).
      </p>
    `)}

    ${card(`
      <h2 class="text-sm font-semibold text-slate-100">Straight answer</h2>
      <div class="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-300">
        <p><b class="text-emerald-300">Timing can matter in principle.</b> An under-mixed drum with a
        known loading order is genuinely exploitable — the simulator finds break-even below a few
        seconds of shaking.</p>
        <p><b class="text-amber-300">Neither condition holds for you.</b> You cannot see the loading
        order, and your archive shows no first-ball skew beyond chance. Without the loading order, a
        positional bias carries no information about which number is where.</p>
        <p><b class="text-sky-300">What does help:</b> pick the ticket with the smallest house edge,
        stake a fixed small amount, and keep the ledger honest. That is a real, measurable
        improvement — from about ${(worst.ev * 100).toFixed(2)}% of stake back to
        ${(best.ev * 100).toFixed(0)}%.</p>
      </div>
    `)}
  </div>`;
}

/* ==========================================================================
 * Backtester view
 * ========================================================================== */

function rateCard(title: string, a: RateAudit, tone: string): string {
  return `
  <div class="rounded-xl border border-white/10 bg-white/[0.03] p-3">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold ${tone}">${esc(title)}</h3>
      <span class="text-[10px] text-slate-500">chance ${tinyPct(a.expectedRate)}</span>
    </div>
    <div class="mt-1.5 flex items-end gap-1">
      <span class="text-2xl font-bold text-slate-50">${a.hits}</span>
      <span class="pb-1 text-xs text-slate-400">/ ${a.trials} draws</span>
    </div>
    <div class="mt-1 text-[11px] text-slate-300">
      observed <b>${tinyPct(a.rate)}</b> · expected <b>${num(a.expectedHits, 2)}</b> hits
    </div>
    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
      <span>95% CI ${tinyPct(a.ci[0])} – ${tinyPct(a.ci[1])}</span>
      <span class="text-slate-600">|</span>
      <span>p <b class="${pTone(a.pValue)}">${a.pValue < 0.0001 ? a.pValue.toExponential(1) : num(a.pValue, 3)}</b></span>
    </div>
  </div>`;
}

function runRow(r: BacktestResult['runs'][number]): string {
  const win = new Set(r.winning);
  const picks = new Set([...r.trio, ...r.pair, r.top1]);
  const marks = [...picks].filter((n) => win.has(n));
  return `
    <tr class="border-b border-white/5 ${r.hit1 ? 'bg-emerald-500/5' : ''}">
      <td class="py-1.5 pr-2 whitespace-nowrap text-slate-400">${esc(r.draw_date)}</td>
      <td class="py-1.5 pr-2 whitespace-nowrap text-[10px] text-slate-500">${esc(r.game_name)}</td>
      <td class="py-1.5 pr-2"><div class="flex gap-1">${r.winning
        .map((n) => ball(n, marks.includes(n) ? 'match' : 'win', true))
        .join('')}</div></td>
      <td class="py-1.5 pr-2"><div class="flex gap-1">${balls(r.trio, 'quiet', true)}</div></td>
      <td class="py-1.5 pr-2 text-center">
        ${r.hit3 ? badge('3', 'ok') : r.hit2 ? badge('2', 'info') : r.hit1 ? badge('1', 'warn') : '<span class="text-slate-600">–</span>'}
      </td>
      <td class="py-1.5 pr-2 text-center text-slate-300">${r.line5Hits}</td>
      <td class="py-1.5 text-right text-[10px] ${zTone(r.trioScore)}">${signed(r.trioScore, 1)}</td>
    </tr>`;
}

export function renderBacktest(state: AppState): string {
  const bt = state.backtest;
  const opts = state.backtestOpts;

  const controls = card(`
    <div class="grid gap-3 sm:grid-cols-4">
      <label class="field">
        <span>Minimum training draws <b id="min-train-val">${opts.minTrain}</b></span>
        <input id="min-train" type="range" min="15" max="60" step="5" value="${opts.minTrain}" />
      </label>
      <label class="field">
        <span>Random baseline sims <b id="simulations-val">${opts.simulations}</b></span>
        <input id="simulations" type="range" min="0" max="800" step="50" value="${opts.simulations}" />
      </label>
      <div class="field justify-end">
        <span>Scope</span>
        <span class="text-xs text-slate-300">${esc(state.game === 'all' ? 'All games pooled' : state.game)} · ${state.draws.length} draws</span>
      </div>
      <div class="field justify-end">
        <button type="button" data-action="run-backtest" class="btn btn-primary w-full"
          ${state.busy === 'backtest' ? 'disabled' : ''}>
          ${state.busy === 'backtest' ? 'Running…' : 'Run walk-forward test'}
        </button>
      </div>
    </div>
    <p class="mt-2 text-[10px] leading-snug text-slate-500">
      Strict protocol: for draw <i>t</i> the engine only ever sees draws 1…t−1. The lookback, Markov
      matrix and Beta posterior are rebuilt from the truncated history at every step, so no future
      information can leak into a prediction.
    </p>
  `);

  if (!bt) {
    return `
    <div class="mx-auto max-w-7xl space-y-4 px-4 py-4">
      ${controls}
      ${card(`<div class="py-10 text-center">
        <p class="text-sm text-slate-300">No backtest yet.</p>
        <p class="mt-1 text-xs text-slate-500">Run the walk-forward test to see hit rates against exact chance.</p>
        <button type="button" data-action="run-backtest" class="btn btn-primary mt-4">Run walk-forward test</button>
      </div>`)}
    </div>`;
  }

  const s = bt.summary;
  const rand = s.randomBaseline;

  return `
  <div class="mx-auto max-w-7xl space-y-4 px-4 py-4">
    ${controls}

    <div class="grid gap-3 sm:grid-cols-3">
      ${rateCard('1-Number hit', s.oneNumber, 'text-emerald-300')}
      ${rateCard('2-Sure (both hit)', s.twoSure, 'text-sky-300')}
      ${rateCard('3-Direct (trio hits)', s.threeDirect, 'text-amber-300')}
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      ${card(`
        <h3 class="text-sm font-semibold text-slate-100">Cumulative hits vs chance</h3>
        <p class="text-[10px] text-slate-500">Engine hits (solid) against the expected line for a random player (dashed).</p>
        <div class="mt-2 h-56"><canvas id="chart-cumulative"></canvas></div>
      `, 'lg:col-span-2')}
      ${card(`
        <h3 class="text-sm font-semibold text-slate-100">5-number line quality</h3>
        <dl class="mt-2 space-y-1 text-[11px]">
          <div class="flex justify-between"><dt class="text-slate-400">Avg hits per line</dt>
            <dd class="text-slate-100">${num(s.line5.avgHits, 3)} <span class="text-slate-500">/ exp ${num(s.line5.expectedHits, 3)}</span></dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Best line</dt>
            <dd class="text-slate-100">${s.line5.bestLine ? `${s.line5.bestLine.hits} hits · ${esc(s.line5.bestLine.date)}` : '—'}</dd></div>
        </dl>
        <div class="mt-3 space-y-1">
          ${Object.entries(s.line5.distribution)
            .map(([hits, count]) => {
              const total = Object.values(s.line5.distribution).reduce((a, b) => a + b, 0) || 1;
              const w = Math.round((count / total) * 100);
              return `<div class="flex items-center gap-2 text-[10px]">
                <span class="w-10 text-slate-400">${hits} hit</span>
                <div class="h-2 flex-1 overflow-hidden rounded bg-white/10"><div class="h-full bg-sky-400/70" style="width:${w}%"></div></div>
                <span class="w-6 text-right text-slate-400">${count}</span>
              </div>`;
            })
            .join('')}
        </div>
        <div class="mt-3 h-28"><canvas id="chart-distribution"></canvas></div>
      `)}
    </div>

    ${card(`
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-slate-100">Edge audit — the honest verdict</h3>
        ${badge(
          rand.simulations > 0
            ? `engine at ${num(rand.percentile, 0)}th percentile of random play`
            : 'random baseline disabled',
          rand.simulations > 0 ? (rand.percentile >= 90 ? 'ok' : 'muted') : 'muted'
        )}
      </div>
      <div class="mt-2 grid gap-3 md:grid-cols-3">
        <div class="rounded-lg bg-black/20 p-2.5">
          <div class="text-[10px] uppercase tracking-wide text-slate-500">Observed vs chance</div>
          <p class="mt-1 text-[11px] leading-relaxed text-slate-300">${esc(s.oneNumber.verdict)}</p>
          <p class="mt-1 text-[11px] leading-relaxed text-slate-300">${esc(s.twoSure.verdict)}</p>
          <p class="mt-1 text-[11px] leading-relaxed text-slate-300">${esc(s.threeDirect.verdict)}</p>
        </div>
        <div class="rounded-lg bg-black/20 p-2.5">
          <div class="text-[10px] uppercase tracking-wide text-slate-500">Random Monte-Carlo</div>
          <dl class="mt-1 space-y-1 text-[11px] text-slate-300">
            <div class="flex justify-between"><dt>Engine 3-Direct hits</dt><dd class="font-semibold">${s.threeDirect.hits}</dd></div>
            <div class="flex justify-between"><dt>Random mean</dt><dd>${num(rand.meanTrioHits, 3)}</dd></div>
            <div class="flex justify-between"><dt>Random 95th pct</dt><dd>${num(rand.p95TrioHits, 1)}</dd></div>
            <div class="flex justify-between"><dt>Engine 1-Number hits</dt><dd class="font-semibold">${s.oneNumber.hits}</dd></div>
            <div class="flex justify-between"><dt>Random mean</dt><dd>${num(rand.meanOneNumberHits, 2)}</dd></div>
          </dl>
        </div>
        <div class="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2.5">
          <div class="text-[10px] uppercase tracking-wide text-amber-300">How to read this</div>
          <p class="mt-1 text-[11px] leading-relaxed text-amber-100/85">
            If the engine sits inside the random distribution, its advantage over flipping coins is zero.
            A p-value below 0.05 on one metric is <i>expected</i> when you test many metrics on a few
            dozen draws — that is multiple-testing noise, not an edge. Three-Direct chance is
            ${tinyPct(CHANCE_THREE)} per draw (about 1 in ${Math.round(1 / CHANCE_THREE).toLocaleString()}),
            so you need hundreds of draws before the statistics can say anything at all.
          </p>
        </div>
      </div>
    `)}

    ${card(`
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-100">Step-by-step audit table</h3>
        <span class="text-[10px] text-slate-500">${bt.runs.length} predictions · newest first</span>
      </div>
      <div class="mt-2 max-h-[420px] overflow-auto">
        <table class="w-full min-w-[620px] text-left text-[11px]">
          <thead class="sticky top-0 bg-[#0b1020] text-[10px] uppercase tracking-wide text-slate-500">
            <tr class="border-b border-white/10">
              <th class="py-1.5 pr-2">Draw</th><th class="py-1.5 pr-2">Game</th>
              <th class="py-1.5 pr-2">Winning</th><th class="py-1.5 pr-2">Predicted trio</th>
              <th class="py-1.5 pr-2 text-center">Hits</th><th class="py-1.5 pr-2 text-center">Line</th>
              <th class="py-1.5 text-right">Trio z</th>
            </tr>
          </thead>
          <tbody>${[...bt.runs].reverse().map(runRow).join('')}</tbody>
        </table>
      </div>
      <p class="mt-2 text-[10px] text-slate-500">
        Chance reference: 1-Number ${tinyPct(CHANCE_ONE)} · 2-Sure ${tinyPct(CHANCE_TWO)} · 3-Direct ${tinyPct(
          CHANCE_THREE
        )} per draw. Highlighted rows are draws where the single strongest pick landed.
      </p>
    `)}
  </div>`;
}

/* ==========================================================================
 * Ledger view
 * ========================================================================== */

export function renderLedger(state: AppState): string {
  // The ledger is the audit trail, not an analysis view: it always lists every
  // game, whatever the deduction filter is set to. Search narrows it instead.
  const filtered = state.draws
    .filter((d) => {
      if (!state.search) return true;
      const q = state.search.toLowerCase();
      return (
        d.draw_date.includes(q) ||
        d.game_name.toLowerCase().includes(q) ||
        [...d.winning, ...d.machine].join(' ').includes(q)
      );
    })
    .sort((a, b) => b.draw_date.localeCompare(a.draw_date));

  const shown = filtered.slice(0, state.ledgerLimit);
  const localDates = new Set(state.overlay.map((d) => d.draw_date));

  return `
  <div class="mx-auto max-w-7xl space-y-4 px-4 py-4">
    <div class="grid gap-4 lg:grid-cols-3">
      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">Add a draw manually</h2>
        <p class="text-[10px] text-slate-500">${state.mode === 'worker' ? 'Saved straight into D1 via POST /api/draws.' : 'Saved to this browser, then push it to GitHub.'}</p>
        <form id="draw-form" class="mt-2 space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <label class="field"><span>Date</span><input id="f-date" type="date" required /></label>
            <label class="field"><span>Game</span>
              <select id="f-game">${GAMES.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select>
            </label>
          </div>
          <div>
            <span class="text-[10px] uppercase tracking-wide text-slate-400">Winning numbers (1–90)</span>
            <div class="mt-1 grid grid-cols-5 gap-1.5">
              ${[1, 2, 3, 4, 5]
                .map(
                  (i) =>
                    `<input id="f-num${i}" class="num-input" inputmode="numeric" min="1" max="90" type="number" placeholder="—" required />`
                )
                .join('')}
            </div>
          </div>
          <div>
            <span class="text-[10px] uppercase tracking-wide text-slate-400">Machine numbers (1–90)</span>
            <div class="mt-1 grid grid-cols-5 gap-1.5">
              ${[1, 2, 3, 4, 5]
                .map(
                  (i) =>
                    `<input id="f-mac${i}" class="num-input" inputmode="numeric" min="1" max="90" type="number" placeholder="—" required />`
                )
                .join('')}
            </div>
          </div>
          <button type="submit" class="btn btn-primary w-full" ${state.busy === 'save-draw' ? 'disabled' : ''}>
            ${state.busy === 'save-draw' ? 'Saving…' : 'Save draw'}
          </button>
        </form>
      `)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">Bulk import</h2>
        <p class="text-[10px] text-slate-500">CSV, JSON, or pasted HTML results — parsed by the same validator as the API.</p>
        <textarea id="import-text" rows="7" class="mt-2 w-full rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[11px] text-slate-200 outline-none focus:border-amber-400/50"
          placeholder="date,game,num1,num2,num3,num4,num5,mac1,mac2,mac3,mac4,mac5
2026-11-23,Monday Special,4,19,33,58,71,8,26,45,62,88"></textarea>
        <div class="mt-2 flex gap-2">
          <button type="button" data-action="import" class="btn btn-primary flex-1" ${state.busy === 'import' ? 'disabled' : ''}>
            ${state.busy === 'import' ? 'Importing…' : 'Parse & import'}
          </button>
          <button type="button" data-action="paste-source" class="btn btn-ghost flex-1" title="Fetch the configured source URL and parse it">
            Pull source URL
          </button>
        </div>
        <p class="mt-2 text-[10px] leading-snug text-slate-500">
          Unparseable rows are reported, never silently dropped. Machine numbers are required:
          NLA publishes 5 winning + 5 machine balls per event.
        </p>
      `)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">Data & sync</h2>
        <dl class="mt-2 space-y-1 text-[11px]">
          <div class="flex justify-between"><dt class="text-slate-400">Mode</dt><dd>${state.mode === 'worker' ? 'Cloudflare Worker + D1' : 'Static (GitHub Pages)'}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Remote draws</dt><dd>${state.mode === 'worker' ? (state.health?.draws ?? state.draws.length) : state.draws.length - state.overlay.length}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Local-only draws</dt><dd>${state.overlay.length}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Last sync</dt><dd>${esc(state.lastSync ?? '—')}</dd></div>
        </dl>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button type="button" data-action="export-json" class="btn btn-ghost">Download JSON</button>
          <button type="button" data-action="export-csv" class="btn btn-ghost">Download CSV</button>
          ${state.overlay.length ? `<button type="button" data-action="clear-overlay" class="btn btn-ghost col-span-2 text-rose-300">Discard ${state.overlay.length} local draw(s)</button>` : ''}
        </div>
        <p class="mt-2 text-[10px] leading-snug text-slate-500">
          ${state.mode === 'worker'
            ? 'D1 is the source of truth. Use the Refresh button (admin key) or the nightly cron.'
            : 'Static hosting: commit the downloaded JSON to <code>data/draws.json</code>, or connect a GitHub token in the Data tab and push with one click.'}
        </p>
      `)}
    </div>

    ${card(`
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-slate-100">Historical ledger <span class="text-slate-500">(${filtered.length} draws, all games)</span></h2>
        <input id="search" type="search" value="${esc(state.search)}" placeholder="Search date, game or number…"
          class="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-400/50 sm:w-64" />
      </div>
      <div class="mt-2 max-h-[520px] overflow-auto">
        <table class="w-full min-w-[640px] text-left text-[11px]">
          <thead class="sticky top-0 bg-[#0b1020] text-[10px] uppercase tracking-wide text-slate-500">
            <tr class="border-b border-white/10">
              <th class="py-1.5 pr-2">Date</th><th class="py-1.5 pr-2">Game</th>
              <th class="py-1.5 pr-2">Winning</th><th class="py-1.5 pr-2">Machine</th>
              <th class="py-1.5 pr-2">Source</th><th class="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            ${shown
              .map((d) => {
                const isLocal = localDates.has(d.draw_date);
                return `<tr class="border-b border-white/5">
                  <td class="py-1.5 pr-2 whitespace-nowrap text-slate-300">${esc(d.draw_date)}</td>
                  <td class="py-1.5 pr-2 whitespace-nowrap text-[10px] text-slate-400">${esc(d.game_name)}</td>
                  <td class="py-1.5 pr-2"><div class="flex gap-1">${balls(d.winning, 'win', true)}</div></td>
                  <td class="py-1.5 pr-2"><div class="flex gap-1">${balls(d.machine, 'machine', true)}</div></td>
                  <td class="py-1.5 pr-2 text-[10px]">${isLocal ? badge('local', 'warn') : badge('db', 'muted')}</td>
                  <td class="py-1.5 text-right">
                    <button type="button" data-action="delete-draw" data-date="${esc(d.draw_date)}"
                      class="text-[10px] text-slate-500 hover:text-rose-300" title="Delete this draw">✕</button>
                  </td>
                </tr>`;
              })
              .join('')}
            ${shown.length === 0 ? `<tr><td colspan="6" class="py-6 text-center text-xs text-slate-500">No draws match this filter.</td></tr>` : ''}
          </tbody>
        </table>
      </div>
      ${filtered.length > shown.length
        ? `<button type="button" data-action="more-rows" class="btn btn-ghost mt-2 w-full">Show ${Math.min(
            100,
            filtered.length - shown.length
          )} more</button>`
        : ''}
    `)}
  </div>`;
}

/* ==========================================================================
 * Data / settings view
 * ========================================================================== */

export function renderSettings(state: AppState): string {
  const staticMode = state.mode === 'static';
  return `
  <div class="mx-auto max-w-7xl space-y-4 px-4 py-4">
    <div class="grid gap-4 lg:grid-cols-2">
      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">Connection</h2>
        <p class="text-[11px] leading-relaxed text-slate-400">
          ${
            staticMode
              ? 'Running as a static site. Everything computes in your browser; D1 is not used. New draws live in this browser until you push them to GitHub.'
              : 'Running on Cloudflare with a D1 database binding. Writes need your ADMIN_KEY.'
          }
        </p>
        <dl class="mt-3 space-y-1.5 text-[11px]">
          <div class="flex justify-between"><dt class="text-slate-400">API base</dt><dd class="text-slate-200">${staticMode ? 'n/a (local engine)' : esc(location.origin + '/api')}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Draws loaded</dt><dd class="text-slate-200">${state.draws.length}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Worker version</dt><dd class="text-slate-200">${esc(state.health?.version ?? '—')}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Admin key configured</dt><dd>${state.health?.hasAdminKey ? badge('yes', 'ok') : badge('no', 'warn')}</dd></div>
        </dl>
        <label class="field mt-3">
          <span>ADMIN_KEY (stored in localStorage only)</span>
          <input id="s-admin" type="password" value="${esc(state.settings.adminKey)}" placeholder="paste your admin key" autocomplete="off" />
        </label>
        <label class="field mt-2">
          <span>Results source URL</span>
          <input id="s-source" type="url" value="${esc(state.settings.sourceUrl)}" placeholder="https://…/results" />
        </label>
      `)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">GitHub-only sync ${staticMode ? '' : '<span class="text-[10px] text-slate-500">(optional)</span>'}</h2>
        <p class="text-[11px] leading-relaxed text-slate-400">
          With a fine-grained token (<code class="text-amber-300">contents: write</code> + <code class="text-amber-300">actions: write</code> on this repo only),
          the browser can commit new draws to <code>data/draws.json</code> and trigger the refresh workflow — no Cloudflare account needed.
          The token is kept in localStorage and sent only to api.github.com.
        </p>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          <label class="field"><span>Repository (owner/name)</span>
            <input id="s-repo" type="text" value="${esc(state.settings.ghRepo)}" placeholder="you/NLA-LOTTO" autocomplete="off" /></label>
          <label class="field"><span>GitHub token</span>
            <input id="s-token" type="password" value="${esc(state.settings.ghToken)}" placeholder="github_pat_…" autocomplete="off" /></label>
        </div>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          <button type="button" data-action="save-settings" class="btn btn-primary">Save settings</button>
          <button type="button" data-action="commit-github" class="btn btn-ghost" ${state.overlay.length ? '' : 'disabled'}>
            Push ${state.overlay.length || ''} local draw(s) to GitHub
          </button>
        </div>
        <button type="button" data-action="trigger-workflow" class="btn btn-ghost mt-2 w-full" ${staticMode ? '' : 'disabled'}>
          Trigger refresh workflow on GitHub
        </button>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          <a class="text-sky-300 underline decoration-dotted hover:text-sky-200" target="_blank" rel="noreferrer"
             href="${esc(workflowUrl(guessRepo(state.settings.ghRepo)))}">Open the refresh workflow ↗</a>
          <a class="text-sky-300 underline decoration-dotted hover:text-sky-200" target="_blank" rel="noreferrer"
             href="https://github.com/settings/personal-access-tokens/new">Create a fine-grained token ↗</a>
        </div>
        <p class="mt-2 text-[10px] leading-snug text-slate-500">
          A browser cannot read results sites directly — they send no CORS headers — so on a
          static site "refresh" means "ask GitHub to run the workflow". That is also why the
          daily 21:00 GMT cron exists: normally you never press this button at all.
        </p>
        <p class="mt-1 text-[10px] leading-snug text-slate-500">
          Never paste a classic token with full repo scope. Fine-grained, single-repo,
          contents+actions write, short expiry.
        </p>
      `)}
    </div>

    ${card(`
      <h2 class="text-sm font-semibold text-slate-100">How this app is honest with you</h2>
      <div class="mt-2 grid gap-3 md:grid-cols-3 text-[11px] leading-relaxed text-slate-300">
        <div>
          <h3 class="mb-1 font-semibold text-emerald-300">What the engine does</h3>
          Frequency evidence (Beta-Binomial), gap anomalies (geometric z-scores), 90×90 transition
          dependencies and combinatorial filters — all reproducible, all visible, all testable.
        </div>
        <div>
          <h3 class="mb-1 font-semibold text-amber-300">What it cannot do</h3>
          Change the probability of a fair draw. NLA 5/90 is fixed odds, so expected return is
          negative no matter which numbers you choose. The Backtester exists to show you that,
          on your own data, with p-values.
        </div>
        <div>
          <h3 class="mb-1 font-semibold text-sky-300">What is worth doing</h3>
          Keep a record, stake a fixed small amount, and treat predictions as a hypothesis log.
          The only reliable "edge" is not overspending: set a budget and stop when it is gone.
        </div>
      </div>
    `)}

    ${card(`
      <h2 class="text-sm font-semibold text-slate-100">Danger zone</h2>
      <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" data-action="reset-config" class="btn btn-ghost">Reset model weights</button>
        <button type="button" data-action="clear-overlay" class="btn btn-ghost">Discard local draws</button>
        <button type="button" data-action="wipe-local" class="btn btn-ghost text-rose-300">Clear all localStorage settings</button>
      </div>
      <p class="mt-2 text-[10px] text-slate-500">Clearing settings removes your stored admin key, source URL and GitHub token from this browser. Server data is untouched.</p>
    `)}
  </div>`;
}

/* ==========================================================================
 * Toasts / overlay
 * ========================================================================== */

export function renderToast(state: AppState): string {
  if (!state.toast) return '';
  const tones = {
    ok: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100',
    bad: 'border-rose-400/40 bg-rose-500/15 text-rose-100',
    info: 'border-sky-400/40 bg-sky-500/15 text-sky-100',
    warn: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
  } as const;
  return `
    <div class="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg">
      <div class="flex items-start gap-2 rounded-xl border px-3 py-2 text-xs shadow-xl ${tones[state.toast.tone]}">
        <span class="flex-1 whitespace-pre-wrap">${esc(state.toast.text)}</span>
        <button type="button" data-action="dismiss-toast" class="text-current/60 hover:text-current">✕</button>
      </div>
    </div>`;
}

export function renderBusy(state: AppState): string {
  if (!state.busy) return '';
  const label =
    state.busy === 'refresh' ? 'Fetching latest results…'
      : state.busy === 'backtest' ? 'Running walk-forward simulations…'
        : state.busy === 'import' ? 'Importing draws…'
          : state.busy === 'save-draw' ? 'Saving draw…'
            : 'Working…';
  return `
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div class="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-sm text-slate-200 shadow-2xl">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-transparent"></span>
        ${esc(label)}
      </div>
    </div>`;
}

export function renderFooter(state: AppState): string {
  return `
  <footer class="mx-auto max-w-7xl px-4 pb-8 pt-2 text-[10px] leading-relaxed text-slate-500">
    <p>
      Ghana NLA 5/90 Mathematical &amp; Logical Deduction Engine v${esc(state.health?.version ?? '1.0.0')} ·
      ${state.mode === 'worker' ? 'Cloudflare Worker + D1' : 'static build'} ·
      built for personal quantitative analysis.
    </p>
    <p class="mt-1">
      Not affiliated with the National Lottery Authority of Ghana. Numbers listed here are
      ${state.mode === 'worker' ? 'your stored history' : 'your local dataset'} — verify every result against the
      official NLA publication before acting on it. Play within your means; if gambling stops being fun, seek help.
    </p>
  </footer>`;
}

export function renderApp(state: AppState): string {
  let panel: string;
  if (state.error) {
    panel = card(`
      <div class="py-8 text-center">
        <p class="text-sm text-rose-300">${esc(state.error)}</p>
        <button type="button" data-action="reload" class="btn btn-primary mt-3">Retry</button>
      </div>`);
  } else if (state.view === 'lab') panel = renderLab(state);
  else if (state.view === 'backtest') panel = renderBacktest(state);
  else if (state.view === 'ledger') panel = renderLedger(state);
  else if (state.view === 'settings') panel = renderSettings(state);
  else panel = renderDeduction(state);

  return `
    ${renderHeader(state)}
    ${renderControls(state)}
    <main id="panel">${panel}</main>
    ${renderFooter(state)}
    ${renderToast(state)}
    ${renderBusy(state)}`;
}
