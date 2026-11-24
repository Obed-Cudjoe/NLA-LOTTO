/**
 * The public site: navigation, landing page, and the plain-English sections.
 *
 * The instrument panel (weights, z-scores, backtest tables, drum simulator) is
 * not part of this file's vocabulary. It lives behind "The tool" and only
 * appears there. Everything a first-time visitor reads is an outcome, a price
 * or a caveat — never a formula.
 */
import { GAME_WEEKDAY, GAMES } from '../types';
import { formatDrawDate } from '../mathEngine';
import { betTypes, coverage, linesForConfidence } from '../bets';
import { isDrawPast, scorePickBook } from '../pickBook';
import { collisionsDuringWalk, collisionsToMix, effectiveMixSeconds } from '../mixing';
import { badge, balls, card, drawWhen, esc, pct, stat, targetHeading } from './format';
import {
  renderBacktest,
  renderBusy,
  renderControls,
  renderDeduction,
  renderFooter,
  renderLab,
  renderLedger,
  renderSettings,
  renderToast,
  renderToolsNav,
} from './views';
import type { AppState, Page } from './types';

/* --------------------------------------------------------------------------
 * Navigation
 * ------------------------------------------------------------------------ */

export const PAGES: Array<{ id: Page; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'tonight', label: 'Tonight' },
  { id: 'results', label: 'Results' },
  { id: 'games', label: 'Games' },
  { id: 'smart', label: 'Play smart' },
  { id: 'method', label: 'The method' },
];

/** `home` is the bare hash; every other page gets its own readable address. */
export const hashFor = (page: Page, view?: string): string =>
  page === 'home' ? '#/' : page === 'tools' ? `#/tools${view ? `/${view}` : ''}` : `#/${page}`;

/** Turn `location.hash` into a page + tool tab. Unknown paths fall back home. */
export function routeFromHash(hash: string): { page: Page; view?: string } {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!path) return { page: 'home' };
  const [head, tail] = path.split('/');
  if (head === 'tools') return { page: 'tools', view: tail || 'deduce' };
  const known = PAGES.find((p) => p.id === head);
  return known ? { page: known.id } : { page: 'home' };
}

export function renderSiteHeader(state: AppState): string {
  const modeBadge =
    state.mode === 'worker' ? badge('Live data · D1', 'ok') : badge('Static archive', 'info');

  const link = (id: Page, label: string): string => `
    <a href="${hashFor(id)}" data-action="goto" data-page="${id}"
      class="nav-link${state.page === id ? ' nav-link-active' : ''}"
      ${state.page === id ? 'aria-current="page"' : ''}>${esc(label)}</a>`;

  return `
  <header class="site-header">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
      <a href="#/" data-action="goto" data-page="home" class="flex items-center gap-2.5">
        <span class="flag-mark" aria-hidden="true">
          <span class="bg-[#ce1126]"></span><span class="bg-[#fcd116]"></span>
          <span class="bg-[#006b3f]"></span><span class="bg-black"></span>
        </span>
        <span class="leading-tight">
          <span class="block text-sm font-semibold tracking-tight text-slate-50">Ghana NLA 5/90</span>
          <span class="block text-[10px] uppercase tracking-[0.14em] text-slate-500">Results · ticket maths · honest tests</span>
        </span>
      </a>

      <nav class="hidden items-center gap-1 md:flex" aria-label="Sections">
        ${PAGES.map((p) => link(p.id, p.label)).join('')}
      </nav>

      <div class="flex items-center gap-2">
        <span class="hidden sm:inline-flex">${modeBadge}</span>
        <a href="#/tools" data-action="goto" data-page="tools"
          class="btn btn-primary">Open the tool <span aria-hidden="true">→</span></a>
      </div>
    </div>

    <nav class="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden" aria-label="Sections">
      ${PAGES.map((p) => link(p.id, p.label)).join('')}
    </nav>
  </header>`;
}

/* --------------------------------------------------------------------------
 * Small building blocks
 * ------------------------------------------------------------------------ */

const n0 = (x: number): string => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-GB') : '—');
const fixed = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : '—');
/** Expected returns span 0.001 to 0.60, so pick the precision that shows it. */
const rate = (x: number): string => (x >= 0.1 ? x.toFixed(2) : x >= 0.01 ? x.toFixed(3) : x.toFixed(4));

/** Probability that at least one of five chosen numbers lands in tonight's five. */
function chanceAtLeastOneOfFive(): number {
  let miss = 1;
  for (let i = 0; i < 5; i++) miss *= (85 - i) / (90 - i);
  return 1 - miss;
}

function sectionHead(eyebrow: string, title: string, lead = ''): string {
  return `
    <div class="max-w-2xl">
      <p class="section-eyebrow">${esc(eyebrow)}</p>
      <h2 class="mt-1 text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">${title}</h2>
      ${lead ? `<p class="mt-2 text-sm leading-relaxed text-slate-400">${lead}</p>` : ''}
    </div>`;
}

function featureCard(opts: {
  icon: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  page: Page;
}): string {
  return `
    <a href="${opts.href}" data-action="goto" data-page="${opts.page}"
      class="feature-card group">
      <span class="feature-icon" aria-hidden="true">${opts.icon}</span>
      <h3 class="mt-3 text-sm font-semibold text-slate-100">${esc(opts.title)}</h3>
      <p class="mt-1.5 text-[12px] leading-relaxed text-slate-400">${opts.body}</p>
      <span class="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-amber-300 group-hover:gap-2 transition-all">
        ${esc(opts.cta)} <span aria-hidden="true">→</span>
      </span>
    </a>`;
}

function gameChips(state: AppState): string {
  const today = new Date().toISOString().slice(0, 10);
  const todayGame = GAMES.find((g) => GAME_WEEKDAY[g] === new Date(`${today}T00:00:00Z`).getUTCDay());
  const items: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'All games' },
    ...GAMES.map((g) => ({ id: g, label: g })),
  ];
  return `
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose a game">
      ${items
        .map(
          (g) => `<button type="button" data-action="pick-game" data-game="${esc(g.id)}"
            class="chip${state.game === g.id ? ' chip-active' : ''}"
            aria-pressed="${state.game === g.id}">${esc(g.label)}${
              g.id === todayGame ? '<span class="ml-1 text-amber-300">· today</span>' : ''
            }</button>`
        )
        .join('')}
    </div>`;
}

/* --------------------------------------------------------------------------
 * Home
 * ------------------------------------------------------------------------ */

function heroCard(state: AppState): string {
  const d = state.deduction;
  if (!d) {
    return card(`
      <p class="text-sm text-slate-300">Waiting for the archive before picking anything.</p>
      <p class="mt-1 text-xs text-slate-500">Import results in the tool, then come back.</p>`);
  }
  const picks = d.evidence.slice(0, 5).map((e) => e.number);
  const today = new Date().toISOString().slice(0, 10);
  const when = drawWhen(d.next.date, today);
  const best = betTypes()[0];

  return `
    <article class="hero-card">
      <div class="flex items-center justify-between gap-2">
        <span class="section-eyebrow">Next draw</span>
        ${badge(d.next.game, 'warn')}
      </div>
      <p class="mt-1 text-xs text-slate-400">
        ${esc(formatDrawDate(d.next.date))} · ${esc(when)} · five from ninety
      </p>

      <div class="mt-4 flex flex-wrap gap-2">
        ${picks.map((n) => `<span class="hero-ball">${n}</span>`).join('')}
      </div>

      <p class="mt-4 text-[12px] leading-relaxed text-slate-300">
        The five numbers the model rates highest from
        <b class="text-slate-100">${n0(d.meta.drawsUsed)}</b> past draws of this game.
        On a fair drum they are exactly as likely as any other five — the ranking is a
        disciplined guess, not a forecast.
      </p>

      <dl class="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-[11px]">
        <div>
          <dt class="text-slate-500">At least one of these five is drawn</dt>
          <dd class="mt-0.5 font-semibold text-slate-100">${pct(chanceAtLeastOneOfFive())}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Best ticket returns, per 1.00 staked</dt>
          <dd class="mt-0.5 font-semibold text-slate-100">${fixed(best.ev)}</dd>
        </div>
      </dl>
    </article>`;
}

function latestResultsStrip(state: AppState): string {
  const recent = [...state.draws].slice(-3).reverse();
  if (!recent.length) return '';
  return `
    <div class="grid gap-3 sm:grid-cols-3">
      ${recent
        .map(
          (d) => `
        <article class="result-card">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-[13px] font-semibold text-slate-100">${esc(d.game_name)}</h3>
            <span class="text-[11px] text-slate-500">${esc(formatDrawDate(d.draw_date))}</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">${balls(d.winning)}</div>
          <p class="mt-2 text-[10px] tracking-wide text-slate-500">
            machine ${d.machine.join(' · ')}
          </p>
        </article>`
        )
        .join('')}
    </div>`;
}

export function renderHome(state: AppState): string {
  const d = state.deduction;
  const draws = state.draws.length;
  const bets = betTypes();
  const best = bets[0];
  const worst = bets[bets.length - 1];
  const jackpot = bets.find((b) => b.id === 'direct5');
  const p = chanceAtLeastOneOfFive();

  return `
  <div class="pb-4">
    <!-- Hero -->
    <section class="mx-auto grid max-w-6xl gap-8 px-4 pb-10 pt-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pt-14">
      <div>
        <p class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          Six evening games · 5 numbers from 90 · archive updated as results land
        </p>
        <h1 class="mt-4 text-3xl font-semibold leading-[1.1] tracking-tight text-slate-50 sm:text-4xl lg:text-[2.9rem]">
          The draw is random.<br />
          <span class="text-amber-300">Getting the arithmetic right isn't.</span>
        </h1>
        <p class="mt-4 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-[15px]">
          A plain-English home for Ghana's NLA 5/90 games: the full results archive,
          what each ticket actually pays back, and the tests that show what a fair drum
          can and cannot do. No promises, no subscription, no numbers sold as destiny.
        </p>
        <div class="mt-6 flex flex-wrap items-center gap-2">
          <a href="#/tonight" data-action="goto" data-page="tonight" class="btn btn-primary px-4 py-2 text-sm">
            See tonight's numbers
          </a>
          <a href="#/method" data-action="goto" data-page="method" class="btn btn-ghost px-4 py-2 text-sm">
            How we test it
          </a>
        </div>
        <p class="mt-4 text-[11px] text-slate-500">
          Everything below is arithmetic you can check. Nothing here raises your chance of winning.
        </p>
      </div>
      ${heroCard(state)}
    </section>

    <!-- Numbers -->
    <section class="border-y border-white/5 bg-black/20">
      <div class="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 py-5 sm:grid-cols-4">
        ${[
          { k: n0(draws), v: 'draws in the archive' },
          { k: '6', v: 'evening games, one a day' },
          { k: pct(p, 0), v: 'chance a five-number line gets a hit' },
          { k: fixed(best.ev), v: `returned per 1.00 on the best ticket` },
        ]
          .map(
            (s) => `
          <div class="px-1">
            <div class="text-xl font-semibold tracking-tight text-slate-50">${s.k}</div>
            <div class="mt-0.5 text-[11px] leading-snug text-slate-500">${s.v}</div>
          </div>`
          )
          .join('')}
      </div>
    </section>

    <!-- What's inside -->
    <section class="mx-auto max-w-6xl px-4 py-10">
      ${sectionHead(
        'What is here',
        'Four things, each one checkable',
        'The site is a reference and a reality check. Read it in five minutes or dig into the tool for as long as you like.'
      )}
      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        ${featureCard({
          icon: '☰',
          title: 'Results archive',
          body: 'Every stored draw for all six games, with the machine numbers and the exact date.',
          href: '#/results',
          page: 'results',
          cta: 'Browse results',
        })}
        ${featureCard({
          icon: '₵',
          title: 'Ticket arithmetic',
          body: `What 40× to 44,000× actually returns. Short version: ${fixed(best.ev)} back per 1.00 at best.`,
          href: '#/smart',
          page: 'smart',
          cta: 'See the payouts',
        })}
        ${featureCard({
          icon: '⚖',
          title: 'The method',
          body: 'The three weak signals, the drum physics, and the first-ball test we ran on real results.',
          href: '#/method',
          page: 'method',
          cta: 'Read the method',
        })}
        ${featureCard({
          icon: '⌘',
          title: 'The tool',
          body: 'The full engine: ranking table, walk-forward backtester, drum-timing lab, timing journal.',
          href: '#/tools',
          page: 'tools',
          cta: 'Open the tool',
        })}
      </div>
    </section>

    <!-- Latest results -->
    <section class="mx-auto max-w-6xl px-4 pb-10">
      <div class="flex flex-wrap items-end justify-between gap-2">
        ${sectionHead('Latest', 'The last three draws', 'Newest first, exactly as published.')}
        <a href="#/results" data-action="goto" data-page="results" class="text-[12px] font-medium text-amber-300 hover:underline">
          All results →
        </a>
      </div>
      <div class="mt-4">${latestResultsStrip(state)}</div>
    </section>

    <!-- Honesty -->
    <section class="mx-auto max-w-6xl px-4 pb-12">
      <div class="honest-band">
        <div class="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <h2 class="text-lg font-semibold tracking-tight text-slate-50">What we won't tell you</h2>
            <p class="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
              That a number is "due". That a pattern is "hot". That a method can beat a fair drum.
              A jackpot line still pays ${jackpot ? `${jackpot.multiplier.toLocaleString()}×` : '44,000×'} on odds of
              about 1 in ${jackpot ? Math.round(jackpot.oneIn).toLocaleString() : '43,949,268'}, and the
              worst ticket listed here keeps ${worst ? pct(worst.houseEdge, 0) : '99.9%'} of everything
              staked on it.
            </p>
            <p class="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
              What we will do is show the working, publish the tests that found nothing, and keep the
              maths optional.
            </p>
          </div>
          <ul class="grid gap-2 text-[12px] text-slate-300">
            ${[
              'No forecast is guaranteed — the drum has no memory.',
              'Every statistical claim on this site is computed from stored draws.',
              'The tool is free, offline-capable and needs no account.',
              // No invented hotline number. Say the true thing and nothing more.
              'If gambling stops being fun, stop — and tell someone you trust.',
            ]
              .map(
                (line) => `<li class="flex gap-2">
                  <span class="mt-0.5 text-emerald-400" aria-hidden="true">✓</span>
                  <span class="leading-relaxed">${esc(line)}</span>
                </li>`
              )
              .join('')}
          </ul>
        </div>
      </div>
    </section>
  </div>`;
}

/* --------------------------------------------------------------------------
 * Tonight
 * ------------------------------------------------------------------------ */

/* --------------------------------------------------------------------------
 * The committed line
 *
 * Five numbers for a perm, a 2-Sure pair, and the trio — plus the locking
 * mechanism that makes the follow-up honest: whatever is picked is scored
 * against the draw that actually happens, at the room's rate, not at a rate the
 * model would like.
 * ------------------------------------------------------------------------ */

function lineCard(state: AppState): string {
  const d = state.deduction;
  if (!d) return '';
  const bets = betTypes();
  const perm = bets.find((b) => b.id === 'direct5');
  const two = bets.find((b) => b.id === 'direct2');
  const three = bets.find((b) => b.id === 'direct3');
  const five = d.evidence.slice(0, 5).map((e) => e.number);
  const pair = five.slice(0, 2);
  const trio = d.trio.numbers.slice(0, 3);
  const locked = state.pickBook.find(
    (p) => p.draw_date === d.next.date && p.game.toLowerCase() === d.next.game.toLowerCase()
  );
  // A line locked after the draw is not a prediction. The button goes dead once
  // the evening window has closed and the result is not yet stored.
  const past = isDrawPast(d.next.date);

  const row = (label: string, numbers: number[], big: boolean, bets: string[], note: string): string => `
    <div class="rounded-xl border border-white/10 bg-black/20 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-[10px] uppercase tracking-wide text-slate-400">${esc(label)}</span>
        <span class="flex flex-wrap items-center gap-1.5">
          ${numbers
            .map((n) => `<span class="${big ? 'hero-ball' : 'ball ball-pick'}" style="${big ? '' : 'width:2.5rem;height:2.5rem;font-size:1rem'}">${n}</span>`)
            .join('')}
        </span>
      </div>
      <p class="mt-1.5 text-[11px] leading-snug text-slate-400">${bets.join(' · ')}</p>
      <p class="text-[10px] leading-snug text-slate-500">${esc(note)}</p>
    </div>`;

  return card(`
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 class="text-sm font-semibold text-slate-100">The line for this draw</h2>
        <p class="text-[11px] text-slate-400">
          ${esc(d.next.game)} · ${esc(formatDrawDate(d.next.date))} ·
          built from ${n0(d.meta.drawsUsed)} stored draws of this game
        </p>
      </div>
      ${badge(locked ? 'locked' : past ? 'draw already held' : 'not locked yet', locked ? 'ok' : past ? 'muted' : 'warn')}
    </div>

    <div class="mt-3 grid gap-2">
      ${row('Perm 5 / Direct 5 — all five, any order', five, true, [
        perm ? `pays ${perm.multiplier.toLocaleString()}×` : 'pays 44,000×',
        perm ? `1 in ${n0(perm.oneIn)}` : '1 in 43,949,268',
      ], 'Play it as a perm and every order of these five is covered. One winning line still returns less than it costs, on average.')}
      ${row('2-Sure — both must be drawn', pair, false, [
        two ? `pays ${two.multiplier.toLocaleString()}×` : 'pays 240×',
        two ? `1 in ${n0(two.oneIn)}` : '1 in 401',
      ], 'The least-bad ticket on the board: it returns about 0.60 per 1.00 staked, so it loses slowly rather than quickly.')}
      ${row('3-Direct — all three must be drawn', trio, false, [
        three ? `pays ${three.multiplier.toLocaleString()}×` : 'pays 2,100×',
        three ? `1 in ${n0(three.oneIn)}` : '1 in 11,748',
      ], 'A long shot, kept because it is the same three numbers the engine ranks highest.')}
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" data-action="lock-pick" class="btn btn-primary"
        ${past && !locked ? 'disabled title="This draw has already been held — locking now would be hindsight"' : ''}>
        ${locked ? 'Re-lock this line' : past ? 'Draw already held' : 'Lock this line before the draw'}
      </button>
      <button type="button" data-action="export-picks" class="btn btn-ghost"
        ${state.pickBook.length ? '' : 'disabled'}>Export the book (CSV)</button>
      <button type="button" data-action="clear-picks" class="btn btn-ghost"
        ${state.pickBook.length ? '' : 'disabled'}>Clear</button>
    </div>
    <p class="mt-2 text-[10px] leading-snug text-slate-500">
      ${
        locked
          ? `Locked ${esc(new Date(locked.locked_at).toLocaleString('en-GB'))} — before the result, so the record cannot be rewritten afterwards.`
          : past
            ? `The ${esc(d.next.game)} draw for ${esc(d.next.date)} has already been held and its result is not stored yet. Locking now would be hindsight, so it is disabled: refresh the results first, and the app will move on to the next draw.`
            : 'Locking stores these numbers with a timestamp in this browser. It changes nothing about the odds; it just means the line is on record before the drum runs.'
      }
    </p>
    <p class="mt-1 text-[10px] leading-snug text-slate-500">
      These five are the numbers the model rates highest. On a fair drum they are exactly as likely as
      any other five — the ranking is a reproducible guess, not an edge.
    </p>
  `);
}

function recordCard(state: AppState): string {
  const rep = state.pickReport;
  if (!rep.locked) return '';
  const { rows } = scorePickBook(state.pickBook, state.draws);
  const recent = [...rows].reverse().slice(0, 6);

  return card(`
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 class="text-sm font-semibold text-slate-100">The record</h2>
        <p class="text-[11px] text-slate-400">
          Every locked line, scored against what was drawn. Chance is the benchmark, not memory.
        </p>
      </div>
      ${badge(`${rep.resolved}/${rep.locked} resolved`, rep.resolved ? 'info' : 'muted')}
    </div>

    <div class="mt-3 grid gap-3 sm:grid-cols-4">
      ${stat('Lines locked', String(rep.locked), 'commitments made before the draw')}
      ${stat('2-Sure hits', String(rep.pairHits), `${rep.expectedPairHits.toFixed(2)} expected by chance`)}
      ${stat('3-Direct hits', String(rep.trioHits), `${rep.expectedTrioHits.toFixed(3)} expected`)}
      ${stat('Numbers drawn', `${rep.matches}/${rep.resolved * 5}`, `${rep.expectedMatches.toFixed(1)} expected`)}
    </div>

    <p class="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5 text-[11px] leading-relaxed text-slate-200">
      ${esc(rep.verdict)}
    </p>

    <div class="mt-2 overflow-x-auto">
      <table class="w-full min-w-[520px] text-left text-[11px]">
        <thead class="text-[10px] uppercase tracking-wide text-slate-500">
          <tr><th class="py-1 pr-2">Draw</th><th class="py-1 pr-2">Five</th><th class="py-1 pr-2">Drawn</th>
            <th class="py-1 pr-2">Hits</th><th class="py-1">2-Sure</th></tr>
        </thead>
        <tbody>
          ${recent
            .map(
              (r) => `<tr class="border-t border-white/5">
                <td class="py-1 pr-2 whitespace-nowrap text-slate-400">${esc(r.draw_date)}</td>
                <td class="py-1 pr-2 whitespace-nowrap text-slate-300">${r.five.join(' · ')}</td>
                <td class="py-1 pr-2 whitespace-nowrap text-slate-400">${r.drawn ? r.drawn.join(' · ') : '—'}</td>
                <td class="py-1 pr-2 ${r.matches.length ? 'text-emerald-300' : 'text-slate-500'}">${r.matches.length}/5</td>
                <td class="py-1">${r.drawn ? (r.pair_hit ? '<span class="text-emerald-300">hit</span>' : '<span class="text-slate-500">miss</span>') : '<span class="text-slate-500">pending</span>'}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `);
}

export function renderTonight(state: AppState): string {
  return `
  <div class="mx-auto max-w-6xl px-4 pt-8">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="section-eyebrow">Tonight</p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Tonight's numbers</h1>
        <p class="mt-1 max-w-xl text-sm leading-relaxed text-slate-400">
          Pick the game and the picks follow its own history and its own next date — Monday's numbers
          come from Monday Special, not from a blend of six games.
        </p>
      </div>
      ${gameChips(state)}
    </div>
    <p class="mt-3 max-w-3xl text-[12px] leading-relaxed text-slate-500">
      This is the place where the maths stays quiet: five numbers, three picks, one plain-English
      reason each, and the result check. Scores, weights and rankings appear only if you press
      <b class="text-slate-400">Show the maths</b>, or open
      <a href="#/tools" data-action="goto" data-page="tools" class="text-amber-300 hover:underline">the tool</a>.
    </p>
  </div>
  <div class="mx-auto mt-4 max-w-6xl space-y-3 px-4">
    ${lineCard(state)}
    ${recordCard(state)}
  </div>
  ${renderDeduction(state)}`;
}

/* --------------------------------------------------------------------------
 * Results
 * ------------------------------------------------------------------------ */

export function renderResults(state: AppState): string {
  return `
  <div class="mx-auto max-w-6xl px-4 pt-8">
    <p class="section-eyebrow">Results</p>
    <h1 class="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Every draw we hold</h1>
    <p class="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
      Winning numbers in draw order, plus the five machine numbers. Verify anything you intend to
      act on against the official NLA publication — this archive is a convenience, not an authority.
    </p>
    <div class="mt-4">${gameChips(state)}</div>
  </div>
  ${renderLedger(state, { tools: false })}`;
}

/* --------------------------------------------------------------------------
 * Games
 * ------------------------------------------------------------------------ */

const DRAW_NOTE =
  'Evening draw. Published times vary between sources and the broadcast has moved: GTV (18:45–19:00) until Nov 2021, UTV (19:15–19:30) from Dec 2021, and GTV again from Dec 2025 at 20:00, with Sunday at 18:00. Treat the slot as "evening, GMT" and check the NLA page for the exact close.';

export function renderGames(state: AppState): string {
  const bets = betTypes();
  const latestFor = (game: string) =>
    [...state.draws].reverse().find((d) => d.game_name.toLowerCase() === game.toLowerCase());
  const today = new Date().toISOString().slice(0, 10);

  return `
  <div class="mx-auto max-w-6xl px-4 py-8">
    ${sectionHead(
      'The games',
      'Six games, one a day, five numbers from ninety',
      'NLA 5/90 runs the same format every weekday evening. Each draw releases five winning numbers and five machine numbers from a single drum of ninety.'
    )}

    <div class="mt-5 overflow-hidden rounded-2xl border border-white/10">
      <table class="w-full text-left text-[12px]">
        <thead class="bg-white/[0.04] text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th class="px-4 py-2">Game</th>
            <th class="px-4 py-2">Drawn</th>
            <th class="px-4 py-2">Slot</th>
            <th class="px-4 py-2">Latest stored result</th>
          </tr>
        </thead>
        <tbody>
          ${GAMES.map((g) => {
            const latest = latestFor(g);
            const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][GAME_WEEKDAY[g]];
            return `<tr class="border-t border-white/5">
              <td class="px-4 py-2.5 font-medium text-slate-100">${esc(g)}${
                GAME_WEEKDAY[g] === new Date(`${today}T00:00:00Z`).getUTCDay()
                  ? ' <span class="ml-1 text-[10px] font-normal text-amber-300">today</span>'
                  : ''
              }</td>
              <td class="px-4 py-2.5 text-slate-300">${esc(wd)}</td>
              <td class="px-4 py-2.5 text-slate-400">Evening</td>
              <td class="px-4 py-2.5">
                ${
                  latest
                    ? `<span class="flex flex-wrap items-center gap-1">${balls(latest.winning, 'win', true)}</span>
                       <span class="text-[10px] text-slate-500">${esc(formatDrawDate(latest.draw_date))}</span>`
                    : '<span class="text-slate-500">—</span>'
                }
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-[11px] text-slate-500">${esc(DRAW_NOTE)}</p>

    <div class="mt-8 grid gap-3 lg:grid-cols-2">
      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">What happens in the draw</h2>
        <ol class="mt-2 space-y-2 text-[12px] leading-relaxed text-slate-300">
          <li><b class="text-slate-100">1.</b> Ninety balls, each weighed and sealed into a loading chamber under supervision.</li>
          <li><b class="text-slate-100">2.</b> The drum mixes for a minimum duration set by procedure — air-mix or gravity-pick depending on the machine.</li>
          <li><b class="text-slate-100">3.</b> Invited spectators are called out of the audience — reportedly one per ball — and each walks to the release button.</li>
          <li><b class="text-slate-100">4.</b> Five balls leave, one release at a time, each written down in the order it arrived.</li>
          <li><b class="text-slate-100">5.</b> Five more follow as machine numbers, drawn from the same ninety.</li>
          <li><b class="text-slate-100">6.</b> The result is published the same evening. Order matters only for Direct 1.</li>
        </ol>
        <p class="mt-3 text-[11px] leading-relaxed text-slate-400">
          Audited loading and a minimum mixing time are fairness procedures, not randomness guarantees
          — the mixing is what does the work. The <a href="#/method" data-action="goto" data-page="method" class="text-amber-300 hover:underline">method page</a>
          shows how much mixing that actually is.
        </p>`)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">What a ticket pays</h2>
        <ul class="mt-2 divide-y divide-white/5">
          ${bets
            .slice()
            .sort((a, b) => a.picks - b.picks)
            .map(
              (b) => `<li class="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                <span class="text-slate-200">${esc(b.label)}</span>
                <span class="text-slate-400">${b.multiplier.toLocaleString()}×</span>
                <span class="text-slate-500">returns ${rate(b.ev)} per 1.00</span>
              </li>`
            )
            .join('')}
        </ul>
        <a href="#/smart" data-action="goto" data-page="smart" class="mt-3 inline-block text-[12px] font-medium text-amber-300 hover:underline">
          Read the full payout arithmetic →
        </a>`)}
    </div>
  </div>`;
}

/* --------------------------------------------------------------------------
 * Play smart
 * ------------------------------------------------------------------------ */

export function renderSmart(state: AppState): string {
  const bets = betTypes();
  const best = bets[0];
  const worst = bets[bets.length - 1];
  const jackpot = bets.find((b) => b.id === 'direct5');
  const half = coverage({
    betId: 'direct5',
    lines: linesForConfidence('direct5', 0.5),
    stakePerLine: 1,
  });

  return `
  <div class="mx-auto max-w-6xl px-4 py-8">
    ${sectionHead(
      'Play smart',
      `Every ticket loses money — some lose it far more slowly`,
      `NLA 5/90 is fixed-odds: the prize is decided by the ticket, not by how many people played. That makes
       the arithmetic exact, and it makes one fact unavoidable — every ticket returns less than it costs.
       The only choice you have is which one loses least per cedi, and how much you stake.`.replace(/\s+/g, ' ')
    )}

    <div class="mt-6 overflow-hidden rounded-2xl border border-white/10">
      <table class="w-full text-left text-[12px]">
        <thead class="bg-white/[0.04] text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th class="px-4 py-2">Ticket</th>
            <th class="px-4 py-2">You pick</th>
            <th class="px-4 py-2">Chance of winning</th>
            <th class="px-4 py-2">Pays</th>
            <th class="px-4 py-2">Back per 1.00</th>
            <th class="px-4 py-2">House keeps</th>
          </tr>
        </thead>
        <tbody>
          ${bets
            .map(
              (b) => `<tr class="border-t border-white/5 ${b.id === best.id ? 'bg-emerald-500/[0.04]' : ''}">
                <td class="px-4 py-2.5 font-medium text-slate-100">
                  ${esc(b.label)}${b.id === best.id ? ' <span class="ml-1 text-[10px] font-normal text-emerald-300">least bad</span>' : ''}${
                    b.id === worst.id ? ' <span class="ml-1 text-[10px] font-normal text-rose-300">worst</span>' : ''
                  }
                </td>
                <td class="px-4 py-2.5 text-slate-300">${b.picks} number${b.picks === 1 ? '' : 's'}</td>
                <td class="px-4 py-2.5 text-slate-300">1 in ${n0(b.oneIn)}</td>
                <td class="px-4 py-2.5 text-slate-300">${b.multiplier.toLocaleString()}×</td>
                <td class="px-4 py-2.5 font-semibold ${b.ev >= 0.5 ? 'text-emerald-300' : b.ev >= 0.1 ? 'text-amber-300' : 'text-rose-300'}">
                  ${rate(b.ev)}
                </td>
                <td class="px-4 py-2.5 text-slate-400">${pct(b.houseEdge, 1)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-[11px] leading-relaxed text-slate-500">
      "Back per 1.00" is the exact expected return: probability × multiplier. Stake 100 on Direct 2
      and you should expect about ${fixed(best.ev * 100, 0)} back over many plays — with long stretches
      of nothing in between. Direct 5 is a lottery within a lottery: it pays
      ${jackpot ? jackpot.multiplier.toLocaleString() : '44,000'}× on a 1-in-${jackpot ? n0(jackpot.oneIn) : '43,949,268'} shot.
    </p>

    <div class="mt-8 grid gap-3 lg:grid-cols-2">
      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">Coverage buys odds, not edge</h2>
        <p class="mt-2 text-[12px] leading-relaxed text-slate-300">
          Buying more lines does raise your chance of holding the winning one. It raises the cost in
          exactly the same proportion, so the expected return stays put. To reach a coin-flip chance on
          Direct 5 you would need about
          <b class="text-slate-100">${n0(half.lines)}</b> lines — a stake of
          <b class="text-slate-100">${n0(half.totalStake)}</b> units to buy an expected return of
          <b class="text-slate-100">${n0(half.expectedReturnValue)}</b>.
        </p>
        <p class="mt-2 text-[12px] leading-relaxed text-slate-400">
          Coverage is a decision about variance and drama. It is not a decision about profitability —
          there is no set of lines, and no picking method, that turns a 0.60-return ticket into a
          1.00-return one.
        </p>`)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">So what can you control?</h2>
        <ul class="mt-2 space-y-2 text-[12px] leading-relaxed text-slate-300">
          <li><b class="text-slate-100">Which ticket.</b> Direct 2 keeps ${pct(best.houseEdge, 0)}; Direct 5 keeps
            ${jackpot ? pct(jackpot.houseEdge, 2) : '99.90%'}. That is the widest lever on the board.</li>
          <li><b class="text-slate-100">How much.</b> A budget set before the draw, in cash, is the only
            variable that changes your life rather than the house's.</li>
          <li><b class="text-slate-100">How often.</b> Chasing a loss multiplies the same negative edge.</li>
          <li><b class="text-slate-100">Which numbers.</b> Nothing. Every combination is equally likely —
            the tool's ranking is a hypothesis it tests against chance, not a claim that it beats it.</li>
        </ul>
        <a href="#/tools/backtest" data-action="goto" data-page="tools" data-view="backtest"
          class="mt-3 inline-block text-[12px] font-medium text-amber-300 hover:underline">
          Run the walk-forward test yourself →
        </a>`)}
    </div>

    <div class="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-[12px] leading-relaxed text-amber-100/85">
      <b class="text-amber-200">The honest summary.</b> There is no betting strategy that makes NLA 5/90
      profitable, because the odds are set that way on purpose. The best available ticket still returns
      ${fixed(best.ev)} per 1.00. If you play, play for the entertainment and set the stake accordingly.
    </div>
  </div>`;
}

/* --------------------------------------------------------------------------
 * The method
 * ------------------------------------------------------------------------ */

export function renderMethod(state: AppState): string {
  // Deliberately the all-games report: a single weekday only holds ~10 draws,
  // which would make the test look far weaker than the archive really is.
  const order = state.orderAll ?? state.order;
  const walk = collisionsDuringWalk(state.lab);
  const needed = collisionsToMix(state.lab);
  const mixSeconds = effectiveMixSeconds(state.lab);
  const bt = state.backtest;

  return `
  <div class="mx-auto max-w-6xl px-4 py-8">
    ${sectionHead(
      'The method',
      'How the numbers are chosen, and how we check them',
      `Three weak signals, combined and then tested against a fair drum. The tests matter more than the signals: any of them failing is a result we publish.`
    )}

    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      ${[
        {
          n: '01',
          t: 'Recency, weighted honestly',
          b: 'A Bayesian count of how often each number appeared recently, with a prior that pulls thin evidence back toward 5-in-90. A number seen twice is not crowned.',
        },
        {
          n: '02',
          t: 'Gaps between appearances',
          b: 'How long each number has been missing, compared with the 18-draw average gap. Long absences are described, never treated as a debt the drum owes.',
        },
        {
          n: '03',
          t: 'What tends to follow what',
          b: 'A first-order Markov count of which numbers appeared in the draw after a given number. With 90×90 cells and a few dozen draws, this is the weakest of the three.',
        },
      ]
        .map(
          (c) => `
        <div class="method-card">
          <span class="text-[10px] font-semibold tracking-[0.2em] text-amber-300/80">${c.n}</span>
          <h3 class="mt-2 text-sm font-semibold text-slate-100">${esc(c.t)}</h3>
          <p class="mt-1.5 text-[12px] leading-relaxed text-slate-400">${esc(c.b)}</p>
        </div>`
        )
        .join('')}
    </div>

    <div class="mt-8 grid gap-3 lg:grid-cols-2">
      ${card(`
        <div class="flex items-start justify-between gap-2">
          <h2 class="text-sm font-semibold text-slate-100">The first-ball test</h2>
          ${order && order.draws > 0 ? badge(order.pValue >= 0.05 ? 'consistent with a fair drum' : 'unusual skew', order.pValue >= 0.05 ? 'ok' : 'warn') : badge('not enough draws', 'muted')}
        </div>
        ${
          order && order.draws > 0
            ? `<p class="mt-2 text-[12px] leading-relaxed text-slate-300">
                NLA publishes the winning numbers in the order they left the machine, so the first ball
                is the one thing a timing theory has to move. Across all
                <b class="text-slate-100">${n0(order.draws)}</b> stored draws the first-ball counts gave a chi-square of
                <b class="text-slate-100">${fixed(order.chiSquare, 1)}</b> on ${order.df} degrees of freedom —
                a Monte-Carlo p-value of <b class="text-slate-100">${fixed(order.pValue, 2)}</b>.
                ${order.pValue >= 0.05 ? 'That is an ordinary amount of wobble for a fair drum.' : 'That is unusual and worth watching, not proof of anything.'}
              </p>
              <p class="mt-2 text-[11px] leading-relaxed text-slate-500">
                Power matters here: with this archive the test could only detect a per-ball lift of
                about <b class="text-slate-300">${fixed(order.detectableLift, 1)}×</b>. A subtle bias would
                still hide. We say "consistent with fair", never "proven fair".
              </p>`
            : `<p class="mt-2 text-[12px] text-slate-400">Run the draw-order test in the tool to populate this.</p>`
        }`)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">The drum does the work</h2>
        <p class="mt-2 text-[12px] leading-relaxed text-slate-300">
          Mixing is measured in collisions. The model assumes a running drum throws balls together
          about ten times a second — an order-of-magnitude figure, not a published NLA measurement —
          and it takes about <b class="text-slate-100">${fixed(needed, 0)}</b> collisions for a
          ball's position to stop carrying information about where it started. The configured shake of
          <b class="text-slate-100">${fixed(state.lab.shakeSeconds, 0)} s</b> supplies
          <b class="text-slate-100">${n0(mixSeconds)} s</b> of effective mixing once the walk to the
          button is counted.
        </p>
        <p class="mt-2 text-[12px] leading-relaxed text-slate-300">
          A guest taking 12 seconds to reach the button contributes about
          <b class="text-slate-100">${n0(walk)}</b> collisions — around
          <b class="text-slate-100">${needed > 0 ? Math.round(walk / needed) : '—'}×</b> what mixing
          needs. Walking slowly therefore makes the draw <em>more</em> uniform, not more readable.
        </p>
        <p class="mt-2 text-[11px] leading-relaxed text-slate-400">
          Spectators are called from the audience during the draw — reportedly one per ball, so a
          single draw contains five separate walks. No source publishes their duration; the
          <a href="#/tools/lab" data-action="goto" data-page="tools" data-view="lab" class="text-amber-300 hover:underline">stopwatch
          in the lab</a> exists so you can time them off the broadcast instead of trusting an estimate.
        </p>
        <a href="#/tools/lab" data-action="goto" data-page="tools" data-view="lab"
          class="mt-3 inline-block text-[12px] font-medium text-amber-300 hover:underline">
          Open the drum-timing lab and move the sliders →
        </a>`)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">The walk-forward backtest</h2>
        <p class="mt-2 text-[12px] leading-relaxed text-slate-300">
          Each draw is predicted using only the draws before it, then scored. The same schedule is
          replayed with random picks, so the engine's hit rate can be compared with luck instead of
          admired in isolation.
        </p>
        ${
          bt
            ? `<p class="mt-2 text-[12px] text-slate-300">Current run: ${n0(bt.runs.length)} predicted draws,
                ${n0(bt.summary.threeDirect.hits)} trio hits against ${fixed(bt.summary.threeDirect.expectedHits, 1)}
                expected by chance; random picks averaged
                ${fixed(bt.summary.randomBaseline.meanTrioHits, 3)} trio hits per draw over
                ${n0(bt.summary.randomBaseline.simulations)} simulated runs.</p>`
            : `<p class="mt-2 text-[12px] text-slate-400">No run loaded yet — it takes a few seconds.</p>`
        }
        <a href="#/tools/backtest" data-action="goto" data-page="tools" data-view="backtest"
          class="mt-3 inline-block text-[12px] font-medium text-amber-300 hover:underline">
          Run the backtest →
        </a>`)}

      ${card(`
        <h2 class="text-sm font-semibold text-slate-100">Test it yourself</h2>
        <p class="mt-2 text-[12px] leading-relaxed text-slate-300">
          Beliefs about timing deserve a test you own. The timing journal records the walk to the
          button, the shake, and the first ball <em>before</em> you see the result, then measures whether
          walk time predicts anything. It refuses to comment on fewer than 60 entries and asks for 300
          before a null result counts.
        </p>
        <a href="#/tools/lab" data-action="goto" data-page="tools" data-view="lab"
          class="mt-3 inline-block text-[12px] font-medium text-amber-300 hover:underline">
          Start a timing journal →
        </a>`)}
    </div>

    <div class="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 class="text-sm font-semibold text-slate-100">What would change our mind</h2>
      <ul class="mt-2 grid gap-2 text-[12px] leading-relaxed text-slate-300 sm:grid-cols-2">
        <li>· A first-ball chi-square that stays extreme as the archive grows past a few hundred draws.</li>
        <li>· A timing journal logged before results, showing a dependency at p &lt; 0.01 with 300+ entries.</li>
        <li>· A walk-forward run whose edge survives the random-pick distribution over hundreds of draws.</li>
        <li>· Evidence that the published draw order is not the release order.</li>
      </ul>
      <p class="mt-3 text-[11px] leading-relaxed text-slate-500">
        None of these has happened in the data held here. If one does, it goes on this page with the
        same prominence as the tests that found nothing.
      </p>
    </div>
  </div>`;
}

/* --------------------------------------------------------------------------
 * Tools
 * ------------------------------------------------------------------------ */

function toolsPanel(state: AppState): string {
  switch (state.view) {
    case 'lab':
      return renderLab(state);
    case 'backtest':
      return renderBacktest(state);
    case 'ledger':
      return renderLedger(state);
    case 'settings':
      return renderSettings(state);
    default:
      return renderDeduction(state);
  }
}

function benchIntro(): string {
  return `
    <div class="mx-auto max-w-7xl px-4 pt-3">
      <p class="text-[11px] text-slate-500">
        This is the working bench: the same numbers as the rest of the site, with the sliders exposed.
        <a href="#/" data-action="goto" data-page="home" class="text-amber-300 hover:underline">Back to the site</a>
      </p>
    </div>`;
}

/* --------------------------------------------------------------------------
 * Shell
 * ------------------------------------------------------------------------ */

/** Just the `<main>` contents — used for partial re-renders while dragging. */
export function renderPanelContent(state: AppState): string {
  switch (state.page) {
    case 'tonight':
      return renderTonight(state);
    case 'results':
      return renderResults(state);
    case 'games':
      return renderGames(state);
    case 'smart':
      return renderSmart(state);
    case 'method':
      return renderMethod(state);
    case 'tools':
      return `${benchIntro()}${toolsPanel(state)}`;
    default:
      return renderHome(state);
  }
}

export function renderSite(state: AppState): string {
  const panel = state.error
    ? card(`
        <div class="py-8 text-center">
          <p class="text-sm text-rose-300">${esc(state.error)}</p>
          <button type="button" data-action="reload" class="btn btn-primary mt-3">Retry</button>
        </div>`)
    : renderPanelContent(state);

  return `
    ${renderSiteHeader(state)}
    ${state.page === 'tools' && !state.error ? renderToolsNav(state) + renderControls(state) : ''}
    <main id="panel" class="${state.page === 'tools' ? 'pb-10' : ''}">${panel}</main>
    ${renderFooter(state)}
    ${renderToast(state)}
    ${renderBusy(state)}`;
}

export { renderBusy, renderToast };
