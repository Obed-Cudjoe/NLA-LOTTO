/** Presentation helpers shared by every view. No DOM access — pure strings. */

export const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const pct = (x: number, digits = 1): string =>
  Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '—';

export const num = (x: number, digits = 2): string =>
  Number.isFinite(x) ? x.toFixed(digits) : '—';

/** Tiny probabilities need scientific notation to be readable. */
export const tinyPct = (x: number): string => {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0%';
  if (x < 0.0001) return `${(x * 100).toExponential(2)}%`;
  return `${(x * 100).toFixed(3)}%`;
};

export const signed = (x: number, digits = 2): string =>
  `${x >= 0 ? '+' : ''}${num(x, digits)}`;

/** Colour class for a z-score: green hot, amber warm, slate neutral, blue cold. */
export const zTone = (z: number): string => {
  if (z >= 1.5) return 'text-emerald-300';
  if (z >= 0.5) return 'text-lime-300';
  if (z > -0.5) return 'text-slate-300';
  if (z > -1.5) return 'text-sky-300';
  return 'text-indigo-300';
};

export const zBar = (z: number): string => {
  if (z >= 1.5) return 'bg-emerald-400';
  if (z >= 0.5) return 'bg-lime-400';
  if (z > -0.5) return 'bg-slate-400';
  if (z > -1.5) return 'bg-sky-400';
  return 'bg-indigo-400';
};

/** Map a z-score onto 0..100% for a bar width. */
export const zWidth = (z: number): number => Math.max(2, Math.min(100, ((z + 2.5) / 5) * 100));

export const ballClass = (kind: 'win' | 'machine' | 'pick' | 'match' | 'quiet'): string => {
  switch (kind) {
    case 'win':
      return 'ball ball-win';
    case 'machine':
      return 'ball ball-machine';
    case 'pick':
      return 'ball ball-pick';
    case 'match':
      return 'ball ball-match';
    default:
      return 'ball ball-quiet';
  }
};

export const ball = (n: number, kind: 'win' | 'machine' | 'pick' | 'match' | 'quiet' = 'win', sm = false): string =>
  `<span class="${ballClass(kind)}${sm ? ' ball-sm' : ''}" title="Number ${n}">${n}</span>`;

export const balls = (
  nums: readonly number[],
  kind: 'win' | 'machine' | 'pick' | 'match' | 'quiet' = 'win',
  sm = false
): string => nums.map((n) => ball(n, kind, sm)).join('');

export const badge = (text: string, tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' = 'muted'): string => {
  const tones: Record<string, string> = {
    ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    bad: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    info: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    muted: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  };
  return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}">${esc(
    text
  )}</span>`;
};

export const check = (ok: boolean, label: string, detail: string): string => `
  <li class="flex items-start gap-2 py-1.5">
    <span class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold ${
      ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
    }">${ok ? '✓' : '✕'}</span>
    <span class="text-sm">
      <span class="${ok ? 'text-slate-100' : 'text-rose-200'} font-medium">${esc(label)}</span>
      <span class="text-slate-400"> — ${esc(detail)}</span>
    </span>
  </li>`;

export const card = (inner: string, extraClass = ''): string =>
  `<section class="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-lg shadow-black/20 backdrop-blur ${extraClass}">${inner}</section>`;

export const stat = (label: string, value: string, hint = '', tone = 'text-slate-100'): string => `
  <div class="rounded-xl border border-white/5 bg-black/20 p-3">
    <div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(label)}</div>
    <div class="mt-0.5 text-lg font-semibold ${tone}">${value}</div>
    ${hint ? `<div class="mt-0.5 text-[11px] leading-tight text-slate-500">${hint}</div>` : ''}
  </div>`;

/** P-value tone: green when clearly above chance, slate otherwise. */
export const pTone = (p: number): string =>
  p <= 0.01 ? 'text-emerald-300' : p <= 0.05 ? 'text-amber-300' : 'text-slate-300';
