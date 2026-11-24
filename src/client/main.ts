/**
 * Dashboard controller: state, data loading, event delegation, rendering.
 * Runs identically against the Worker API (/api/*) or as a static GitHub Pages
 * site (data/draws.json + localStorage overlay).
 */
import {
  DEFAULT_CONFIG,
  backtest as runBacktestEngine,
  deduce,
  reviewLastDraw,
  filterByGame,
  gameForDate,
  normalizeHistory,
  parseCsv,
  rowToDraw,
  validateDraw,
  type Draw,
  type EngineConfig,
} from '../mathEngine';
import { DEFAULT_MIXING } from '../mixing';
import { analyseTimingJournal, journalToCsv, type TimingEntry } from '../timingJournal';
import { analyseDrawOrder } from '../drawOrder';
import {
  emptyReport,
  isDrawPast,
  lockPick,
  pickBookToCsv,
  pickFromDeduction,
  scorePickBook,
} from '../pickBook';
import { parsePayload } from '../scraper';
import * as store from './store';
import { destroyAllCharts, renderBacktestCharts } from './charts';
import { renderSite, renderPanelContent, hashFor, routeFromHash } from './site';
import type { AppState, Mode, Page, Tone, View } from './types';

const ui = store.loadUi();

const state: AppState = {
  mode: 'static',
  page: 'home',
  health: null,
  draws: [],
  overlay: store.loadOverlay(),
  // Default to tonight's game: Monday's picks should come from Monday Special's
  // own history, not a blend of six games. Falls back to pooled on a Sunday
  // (no evening draw) or before the schedule is known.
  game: ui.game ?? todayGame() ?? 'all',
  config: store.loadConfig(),
  view: (ui.view as View) ?? 'deduce',
  deduction: null,
  review: null,
  order: null,
  orderAll: null,
  lab: { ...DEFAULT_MIXING, ...(ui.lab ?? {}) },
  journal: store.loadJournal(),
  journalReport: null,
  stopwatch: { walkStart: null, walkSeconds: null, shakeStart: null, shakeSeconds: null },
  pickBook: store.loadPickBook(),
  pickReport: emptyReport(),
  backtest: null,
  backtestOpts: { minTrain: ui.minTrain ?? 25, simulations: ui.simulations ?? 300 },
  settings: store.loadSettings(),
  busy: null,
  toast: null,
  search: '',
  ledgerLimit: 60,
  advanced: ui.advanced ?? false,
  lastSync: null,
  error: null,
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel);

/** Response.json() is typed `unknown` under the Workers lib — normalise it. */
async function readJson(res: Response): Promise<Record<string, any>> {
  try {
    const value = await res.json();
    return (value && typeof value === 'object' ? value : {}) as Record<string, any>;
  } catch {
    return {};
  }
}

const setText = (id: string, text: string): void => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

let toastTimer: number | undefined;
function toast(text: string, tone: Tone = 'info'): void {
  state.toast = { text, tone };
  render();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, tone === 'bad' ? 12000 : 7000);
}

/* ==========================================================================
 * Rendering
 * ========================================================================== */

/**
 * The site shell is rebuilt on navigation; only the panel is replaced during
 * slider drags so focus and scroll position survive.
 */
function panelHtml(): string {
  return renderPanelContent(state);
}

function render(): void {
  const app = $('#app');
  if (!app) return;
  destroyAllCharts();
  app.innerHTML = renderSite(state);
  if (state.view === 'backtest' && state.backtest) {
    requestAnimationFrame(() => {
      try {
        renderBacktestCharts(state.backtest!);
      } catch {
        /* charts are decorative */
      }
    });
  }
}

/** Re-render only the tab panel (keeps slider focus alive while dragging). */
function renderPanel(): void {
  const panel = $('#panel');
  if (!panel) {
    render();
    return;
  }
  destroyAllCharts();
  panel.innerHTML = panelHtml();
  if (state.view === 'backtest' && state.backtest) {
    requestAnimationFrame(() => {
      try {
        renderBacktestCharts(state.backtest!);
      } catch {
        /* ignore */
      }
    });
  }
}

function refreshControlReadouts(): void {
  const w = normalizeWeightPreview();
  setText('pill-bayes', `B ${Math.round(w.bayes * 100)}%`);
  setText('pill-poisson', `P ${Math.round(w.poisson * 100)}%`);
  setText('pill-markov', `M ${Math.round(w.markov * 100)}%`);
}

function normalizeWeightPreview(): EngineConfig['weights'] {
  const b = Math.max(0, state.config.weights.bayes);
  const p = Math.max(0, state.config.weights.poisson);
  const m = Math.max(0, state.config.weights.markov);
  const t = b + p + m || 1;
  return { bayes: b / t, poisson: p / t, markov: m / t };
}

/* ==========================================================================
 * Data
 * ========================================================================== */

function coerceDraw(value: unknown): Draw | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (Array.isArray(raw.winning) && Array.isArray(raw.machine)) {
    const result = validateDraw({
      draw_date: raw.draw_date,
      game_name: raw.game_name,
      winning: raw.winning,
      machine: raw.machine,
    });
    return result.ok ? result.draw ?? null : null;
  }
  if (raw.num1 !== undefined && raw.mac1 !== undefined) {
    return rowToDraw(raw as unknown as Parameters<typeof rowToDraw>[0]);
  }
  return null;
}

async function detectMode(): Promise<Mode> {
  try {
    const res = await fetch('/api/health', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    const contentType = res.headers.get('content-type') ?? '';
    if (res.ok && contentType.includes('json')) {
      const data = await readJson(res);
      if (data && (data.service || data.ok !== undefined)) {
        state.health = data as AppState['health'];
        return 'worker';
      }
    }
  } catch {
    /* static host or offline */
  }
  return 'static';
}

async function loadDraws(): Promise<void> {
  let remote: Draw[] = [];
  if (state.mode === 'worker') {
    const res = await fetch('/api/draws?limit=5000', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Could not load draws from the Worker (HTTP ${res.status}).`);
    const data = await readJson(res);
    remote = ((data.draws ?? []) as unknown[]).map(coerceDraw).filter((d: Draw | null): d is Draw => Boolean(d));
  } else {
    // The query string defeats the Pages CDN cache when we poll after a refresh.
    const res = await fetch(`data/draws.json?v=${Date.now()}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load data/draws.json (HTTP ${res.status}). Run npm run build.`);
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data) ? data : ((data as { draws?: unknown[] }).draws ?? []);
    remote = (list as unknown[]).map(coerceDraw).filter((d): d is Draw => Boolean(d));
  }
  // Belt and braces: the scraper refuses future rows, but a hand-edited
  // data/draws.json (or a stale overlay) should not be able to either.
  const todayIso = new Date().toISOString().slice(0, 10);
  const notFuture = (d: Draw): boolean => d.draw_date <= todayIso;
  state.draws = normalizeHistory([...remote, ...state.overlay].filter(notFuture));
}

/** The game drawn today (UTC), or null on a Sunday. */
function todayGame(): string | null {
  return gameForDate(new Date().toISOString().slice(0, 10));
}

function recompute(): void {
  const scoped = filterByGame(state.draws, state.game);
  if (scoped.length < 5) {
    state.deduction = null;
    state.review = null;
    state.order = null;
    state.orderAll = analyseDrawOrder(state.draws);
    state.pickReport = scorePickBook(state.pickBook, state.draws).report;
    return;
  }
  const config: EngineConfig = {
    ...state.config,
    lookback: Math.max(5, Math.min(state.config.lookback, scoped.length)),
  };
  const targetGame = state.game === 'all' ? undefined : state.game;
  state.deduction = deduce(scoped, config, targetGame);
  state.review = reviewLastDraw(scoped, config, targetGame);
  // First-ball analysis is cheap enough to run on every recompute and is the
  // only honest test of the "machine timing matters" hypothesis.
  state.order = analyseDrawOrder(scoped);
  state.pickReport = scorePickBook(state.pickBook, state.draws).report;
  // The method page reports the whole archive, not the selected game, so say
  // 60 draws rather than the 10 a single weekday happens to hold.
  state.orderAll = analyseDrawOrder(state.draws);
  state.journalReport = analyseTimingJournal(state.journal);
}

async function reloadData(): Promise<void> {
  await loadDraws();
  recompute();
  state.lastSync = new Date().toLocaleTimeString();
  render();
}

/* ==========================================================================
 * Actions
 * ========================================================================== */

function persistConfig(): void {
  store.saveConfig(state.config);
}

async function runBacktest(): Promise<void> {
  if (state.draws.length < 25) {
    toast('Not enough history — add draws first (at least 25 for a meaningful test).', 'warn');
    return;
  }
  state.busy = 'backtest';
  render();
  await new Promise((r) => setTimeout(r, 40));
  try {
    state.backtest = runBacktestEngine(state.draws, state.config, {
      minTrain: state.backtestOpts.minTrain,
      game: state.game === 'all' ? null : state.game,
      simulations: state.backtestOpts.simulations,
    });
    const s = state.backtest.summary;
    toast(
      `Walk-forward complete: ${s.draws} predictions · 1-Number ${s.oneNumber.hits} · 2-Sure ${s.twoSure.hits} · 3-Direct ${s.threeDirect.hits}.`,
      'ok'
    );
  } catch (err) {
    toast(`Backtest failed: ${err instanceof Error ? err.message : String(err)}`, 'bad');
  } finally {
    state.busy = null;
    render();
  }
}

async function refreshWorker(): Promise<void> {
  if (!state.settings.adminKey) {
    const entered = window.prompt(
      'Enter your ADMIN_KEY (it is stored in this browser\'s localStorage only):',
      ''
    );
    if (!entered) return;
    state.settings.adminKey = entered.trim();
    store.saveSettings(state.settings);
  }

  state.busy = 'refresh';
  render();
  try {
    const res = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': state.settings.adminKey },
      body: JSON.stringify({}),
    });
    const data = await readJson(res);
    state.busy = null;
    if (res.ok) {
      const inserted = Number(data.inserted ?? 0);
      const skipped = Number(data.skipped ?? 0);
      toast(
        inserted > 0
          ? `Refresh successful — ${inserted} new draw(s), ${skipped} already stored.`
          : `Source reached, but nothing new (${skipped} already stored).`,
        inserted > 0 ? 'ok' : 'info'
      );
      await reloadData();
    } else {
      toast(`Refresh failed: ${data.error ?? `HTTP ${res.status}`}`, 'bad');
      render();
    }
  } catch (err) {
    state.busy = null;
    toast(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`, 'bad');
    render();
  }
}

const repoGuess = (): string => store.guessRepo(state.settings.ghRepo);
const actionsUrl = (): string => store.workflowUrl(repoGuess());

/**
 * Static mode has no server, and results sites never send CORS headers, so an
 * in-browser refresh cannot work — not here, not with a different source. The
 * daily job belongs to GitHub Actions. With a token we dispatch it right now
 * and watch for the resulting commit; without one we land the user on the Data
 * tab, which holds the controls that actually do something.
 */
async function refreshStatic(): Promise<void> {
  const repo = repoGuess();
  const token = state.settings.ghToken.trim();

  if (!repo || !token) {
    toast(
      'Static site: the daily refresh runs on GitHub, not in your browser (results sites block cross-origin reads).\n' +
        `Open Actions → "Refresh draw results" → Run workflow, or paste a token below to dispatch it from here.\n${actionsUrl()}`,
      'warn'
    );
    state.view = 'settings';
    store.saveUi({ view: 'settings' });
    render();
    return;
  }

  state.busy = 'refresh';
  render();
  const result = await store.triggerRefreshWorkflow(repo, token);
  state.busy = null;
  render();
  if (!result.ok) {
    toast(result.message, 'bad');
    return;
  }
  toast(`${result.message} Watching for the new draw…`, 'ok');
  watchForNewDraws(state.draws.at(-1)?.draw_date ?? '');
}

/**
 * GitHub Pages serves data/draws.json through a CDN, so poll with a
 * cache-busting query until the newest date moves (or we give up).
 */
async function watchForNewDraws(before: string, tries = 8): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    try {
      await loadDraws();
    } catch {
      continue;
    }
    const newest = state.draws.at(-1)?.draw_date ?? '';
    if (newest !== before) {
      recompute();
      render();
      toast(`New draw picked up: ${newest}. Scores recomputed.`, 'ok');
      return;
    }
  }
  toast('GitHub has not published a new draw yet. Give it another minute, or check the Actions run.', 'warn');
}

function applyLocalDraws(draws: Draw[]): void {
  const merged = normalizeHistory([...state.overlay, ...draws]);
  const added = merged.length - state.overlay.length;
  state.overlay = merged;
  store.saveOverlay(state.overlay);
  state.draws = normalizeHistory([...state.draws, ...draws]);
  recompute();
  render();
  if (added <= 0) toast('Those draws were already in local storage (or duplicate dates).', 'info');
}

async function saveDrawFromForm(): Promise<void> {
  const date = (document.getElementById('f-date') as HTMLInputElement | null)?.value ?? '';
  const game = (document.getElementById('f-game') as HTMLSelectElement | null)?.value ?? 'Monday Special';
  const nums: number[] = [];
  const macs: number[] = [];
  for (let i = 1; i <= 5; i++) {
    nums.push(Number((document.getElementById(`f-num${i}`) as HTMLInputElement | null)?.value));
    macs.push(Number((document.getElementById(`f-mac${i}`) as HTMLInputElement | null)?.value));
  }
  const result = validateDraw({ draw_date: date, game_name: game, winning: nums, machine: macs });
  if (!result.ok || !result.draw) {
    toast(`Invalid draw: ${result.errors.join('; ')}`, 'bad');
    return;
  }
  await submitDraws([result.draw]);
  const form = document.getElementById('draw-form') as HTMLFormElement | null;
  form?.reset();
}

async function submitDraws(draws: Draw[]): Promise<void> {
  state.busy = 'save-draw';
  render();
  try {
    if (state.mode === 'worker') {
      if (!state.settings.adminKey) {
        const entered = window.prompt('Enter your ADMIN_KEY to write to D1:', '');
        if (!entered) {
          state.busy = null;
          render();
          return;
        }
        state.settings.adminKey = entered.trim();
        store.saveSettings(state.settings);
      }
      const res = await fetch('/api/draws', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': state.settings.adminKey },
        body: JSON.stringify({ draws }),
      });
      const data = await readJson(res);
      state.busy = null;
      if (!res.ok) {
        toast(`Save failed: ${data.error ?? `HTTP ${res.status}`}`, 'bad');
        render();
        return;
      }
      toast(`Saved ${data.inserted ?? 0} draw(s) to D1 (${data.skipped ?? 0} duplicate).`, 'ok');
      await reloadData();
    } else {
      state.busy = null;
      applyLocalDraws(draws);
      toast(`Saved ${draws.length} draw(s) locally. Push to GitHub from the Data tab when ready.`, 'ok');
    }
  } catch (err) {
    state.busy = null;
    toast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'bad');
    render();
  }
}

async function importFromTextarea(): Promise<void> {
  const textarea = document.getElementById('import-text') as HTMLTextAreaElement | null;
  const text = textarea?.value.trim() ?? '';
  if (!text) {
    toast('Paste CSV, JSON or the raw results page first.', 'warn');
    return;
  }
  state.busy = 'import';
  render();

  let draws: Draw[] = [];
  const errors: string[] = [];

  const looksJson = text.startsWith('[') || text.startsWith('{');
  const looksCsv = /^[\s]*["']?(date|draw_date)/i.test(text) || /^\d{4}-\d{2}-\d{2}\s*,/.test(text);

  if (looksJson) {
    try {
      const payload = JSON.parse(text);
      const items = Array.isArray(payload) ? payload : (payload.draws ?? [payload]);
      for (const item of items) {
        const d = coerceDraw(item);
        if (d) draws.push(d);
        else {
          const v = validateDraw(item);
          errors.push(v.errors.join('; '));
        }
      }
    } catch (err) {
      errors.push(`JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (looksCsv) {
    const parsed = parseCsv(text);
    draws = parsed.rows;
    errors.push(...parsed.errors);
  } else {
    const parsed = parsePayload(text, 'text/html', {
      defaultGame: state.game === 'all' ? 'Monday Special' : state.game,
      today: new Date().toISOString().slice(0, 10),
    });
    draws = parsed.draws;
    errors.push(...parsed.errors, ...parsed.warnings);
  }

  state.busy = null;
  if (!draws.length) {
    render();
    toast(`Nothing imported. ${errors.slice(0, 3).join(' | ')}`, 'bad');
    return;
  }
  toast(`Parsed ${draws.length} valid draw(s)${errors.length ? `, ${errors.length} row(s) rejected` : ''}.`, 'ok');
  await submitDraws(draws);
}

async function pullSourceIntoTextarea(): Promise<void> {
  const url = state.settings.sourceUrl.trim();
  if (!url) {
    toast('Set a results source URL in the Data tab first.', 'warn');
    return;
  }
  try {
    const res = await fetch(url, { headers: { accept: 'text/html,application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const parsed = parsePayload(body, res.headers.get('content-type') ?? '', {
      today: new Date().toISOString().slice(0, 10),
    });
    const textarea = document.getElementById('import-text') as HTMLTextAreaElement | null;
    if (!textarea) return;
    if (parsed.draws.length) {
      textarea.value = store.drawsToCsv([...parsed.draws].reverse());
      toast(`Parsed ${parsed.draws.length} draw(s) into the box — review, then click Parse & import.`, 'ok');
    } else {
      textarea.value = body.slice(0, 20000);
      toast(`No draws auto-detected (${parsed.errors[0] ?? 'unknown layout'}). The raw page is in the box for manual review.`, 'warn');
    }
  } catch (err) {
    toast(
      `Direct fetch blocked: ${err instanceof Error ? err.message : String(err)}. ` +
        'Copy the page text from your browser (Ctrl+A, Ctrl+C) and paste it into the box instead — parsing happens locally.' ,
      'bad'
    );
  }
}

function exportAll(format: 'json' | 'csv'): void {
  const draws = normalizeHistory(state.draws);
  if (!draws.length) {
    toast('Nothing to export yet.', 'warn');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const body = JSON.stringify(
      draws.map((d) => ({ draw_date: d.draw_date, game_name: d.game_name, winning: d.winning, machine: d.machine })),
      null,
      2
    );
    store.downloadFile(`nla-5-90-draws-${stamp}.json`, `${body}\n`);
  } else {
    store.downloadFile(`nla-5-90-draws-${stamp}.csv`, store.drawsToCsv(draws), 'text/csv');
  }
  toast(`Exported ${draws.length} draws.`, 'ok');
}

/* ==========================================================================
 * Stopwatch
 *
 * The only honest way to answer "how long does the walk take?" is to time a
 * broadcast, so the lab gets a two-tap timer instead of a guess. It writes into
 * the timing journal, which is what the statistics actually need.
 * ========================================================================== */

let swTicker: number | undefined;

function paintStopwatch(): void {
  const sw = state.stopwatch;
  const walk = document.getElementById('sw-walk-elapsed');
  const shake = document.getElementById('sw-shake-elapsed');
  if (walk && sw.walkStart !== null) walk.textContent = `${((performance.now() - sw.walkStart) / 1000).toFixed(1)}s`;
  if (shake && sw.shakeStart !== null) shake.textContent = `${((performance.now() - sw.shakeStart) / 1000).toFixed(1)}s`;
  if (sw.walkStart === null && sw.shakeStart === null && swTicker !== undefined) {
    clearInterval(swTicker);
    swTicker = undefined;
  }
}

function startStopwatchTicker(): void {
  if (swTicker !== undefined) return;
  swTicker = window.setInterval(paintStopwatch, 200);
}

/* ==========================================================================
 * Routing
 *
 * The site is a set of real addresses (`#/results`, `#/tools/lab`), not just
 * client-side state: links can be shared, the back button works, and a
 * bookmark lands on the section that was open.
 * ========================================================================== */

function applyRoute(forceRender = false): void {
  const { page, view } = routeFromHash(window.location.hash);
  const nextView = page === 'tools' && view ? (view as View) : state.view;
  const changed = state.page !== page || state.view !== nextView;
  state.page = page;
  state.view = nextView;
  if (page === 'tools') store.saveUi({ view: state.view });
  if (forceRender || changed) render();
}

function navigate(page: Page, view?: View): void {
  const target = hashFor(page, view);
  if (window.location.hash !== target) {
    try {
      window.history.pushState(null, '', target);
    } catch {
      window.location.hash = target;
    }
  }
  applyRoute(true);
  if (page === 'tools' && state.view === 'backtest' && !state.backtest) void runBacktest();
}

/* ==========================================================================
 * Event wiring (delegated so re-renders never lose handlers)
 * ========================================================================== */

function bindEvents(): void {
  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action ?? '';
    // Navigation is handled here: anchors keep their href for copy/paste and
    // middle-click, but a plain click routes without a page reload.
    if (action === 'goto') event.preventDefault();
    void handleAction(action, target);
  });

  window.addEventListener('hashchange', () => applyRoute());
  window.addEventListener('popstate', () => applyRoute());

  document.addEventListener('submit', (event) => {
    event.preventDefault();
    if ((event.target as HTMLElement).id === 'draw-form') void saveDrawFromForm();
  });

  document.addEventListener('change', (event) => {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    if (el.id === 'game-select') {
      state.game = el.value;
      store.saveUi({ game: state.game });
      state.backtest = null;
      recompute();
      render();
      return;
    }
    const numericBindings: Record<string, () => void> = {
      prior: () => (state.config.bayesPriorStrength = Number((el as HTMLInputElement).value) || DEFAULT_CONFIG.bayesPriorStrength),
      alpha: () => (state.config.markovAlpha = Math.max(0, Number((el as HTMLInputElement).value) || 0)),
      machine: () => (state.config.markovMachineWeight = Math.min(1, Math.max(0, Number((el as HTMLInputElement).value)))),
      gap: () => (state.config.expectedGap = Math.max(2, Number((el as HTMLInputElement).value) || 18)),
      'f-decade': () => (state.config.filters.decadeSpread = (el as HTMLInputElement).checked),
      'f-parity': () => (state.config.filters.parityBalance = (el as HTMLInputElement).checked),
      'f-sumrange': () => (state.config.filters.sumRange = (el as HTMLInputElement).checked),
      'f-minsum': () => (state.config.filters.minSum = Number((el as HTMLInputElement).value) || 75),
      'f-maxsum': () => (state.config.filters.maxSum = Number((el as HTMLInputElement).value) || 195),
    };
    if (numericBindings[el.id]) {
      numericBindings[el.id]();
      persistConfig();
      recompute();
      renderPanel();
    }
  });

  let modelTimer: number | undefined;
  let searchTimer: number | undefined;

  document.addEventListener('input', (event) => {
    const el = event.target as HTMLInputElement;
    const debounceModel = () => {
      clearTimeout(modelTimer);
      modelTimer = window.setTimeout(() => {
        persistConfig();
        recompute();
        refreshControlReadouts();
        renderPanel();
      }, 250);
    };

    switch (el.id) {
      case 'lab-walk':
        state.lab = { ...state.lab, walkSeconds: Number(el.value) };
        store.saveUi({ lab: state.lab });
        render();
        return;
      case 'lab-shake':
        state.lab = { ...state.lab, shakeSeconds: Number(el.value) };
        store.saveUi({ lab: state.lab });
        render();
        return;
      case 'lab-interval':
        state.lab = { ...state.lab, interReleaseSeconds: Number(el.value) };
        store.saveUi({ lab: state.lab });
        render();
        return;
      case 'lab-tau':
        state.lab = { ...state.lab, tau: Number(el.value) };
        store.saveUi({ lab: state.lab });
        render();
        return;
      case 'lookback':
        state.config.lookback = Math.max(5, Number(el.value));
        setText('lookback-val', String(state.config.lookback));
        debounceModel();
        break;
      case 'pool-size':
        state.config.poolSize = Math.max(3, Number(el.value));
        setText('pool-val', String(state.config.poolSize));
        debounceModel();
        break;
      case 'w-bayes':
      case 'w-poisson':
      case 'w-markov': {
        const key = el.id === 'w-bayes' ? 'bayes' : el.id === 'w-poisson' ? 'poisson' : 'markov';
        const labelId = el.id === 'w-bayes' ? 'wb-val' : el.id === 'w-poisson' ? 'wp-val' : 'wm-val';
        state.config.weights[key] = Math.max(0, Number(el.value)) / 100;
        setText(labelId, `${Math.round(Number(el.value))}%`);
        refreshControlReadouts();
        debounceModel();
        break;
      }
      case 'min-train':
        state.backtestOpts.minTrain = Math.max(10, Number(el.value));
        setText('min-train-val', String(state.backtestOpts.minTrain));
        store.saveUi({ minTrain: state.backtestOpts.minTrain });
        break;
      case 'simulations':
        state.backtestOpts.simulations = Math.max(0, Number(el.value));
        setText('simulations-val', String(state.backtestOpts.simulations));
        store.saveUi({ simulations: state.backtestOpts.simulations });
        break;
      case 'search':
        state.search = el.value;
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => renderPanel(), 200);
        break;
      default:
        break;
    }
  });
}

async function handleAction(action: string, el: HTMLElement): Promise<void> {
  switch (action) {
    case 'goto': {
      navigate((el.dataset.page as Page) ?? 'home', el.dataset.view as View | undefined);
      break;
    }
    case 'pick-game': {
      state.game = el.dataset.game ?? 'all';
      store.saveUi({ game: state.game });
      state.backtest = null;
      recompute();
      render();
      break;
    }
    case 'tab': {
      const view = (el.dataset.tab as View) ?? 'deduce';
      state.page = 'tools';
      state.view = view;
      store.saveUi({ view });
      const target = hashFor('tools', view);
      if (window.location.hash !== target) {
        try {
          window.history.pushState(null, '', target);
        } catch {
          /* jsdom without history support — state still routes */
        }
      }
      if (view === 'backtest' && !state.backtest) {
        render();
        await runBacktest();
        return;
      }
      render();
      break;
    }
    case 'refresh':
      if (state.mode === 'worker') await refreshWorker();
      else await refreshStatic();
      break;
    case 'run-backtest':
      await runBacktest();
      break;
    case 'lock-pick': {
      if (!state.deduction) {
        toast('No line to lock yet — the archive is still loading.', 'warn');
        return;
      }
      if (isDrawPast(state.deduction.next.date)) {
        toast('That draw has already been held — a line locked now would be hindsight. Refresh the results first.', 'warn');
        return;
      }
      const pick = pickFromDeduction(state.deduction);
      state.pickBook = lockPick(state.pickBook, pick);
      store.savePickBook(state.pickBook);
      state.pickReport = scorePickBook(state.pickBook, state.draws).report;
      render();
      toast(
        `Locked ${pick.five.join(' · ')} for ${pick.game} on ${pick.draw_date}. Scored automatically once the result is stored.`,
        'ok'
      );
      break;
    }
    case 'export-picks': {
      const { rows } = scorePickBook(state.pickBook, state.draws);
      if (!rows.length) {
        toast('Nothing in the book yet.', 'warn');
        break;
      }
      store.downloadFile('nla-pick-book.csv', pickBookToCsv(rows), 'text/csv');
      break;
    }
    case 'clear-picks': {
      if (!window.confirm('Delete every locked line? The record cannot be rebuilt afterwards.')) break;
      state.pickBook = [];
      store.savePickBook([]);
      state.pickReport = emptyReport();
      render();
      toast('Pick book cleared.', 'info');
      break;
    }
    case 'sw-tap': {
      const phase = el.dataset.phase === 'shake' ? 'shake' : 'walk';
      const now = performance.now();
      if (phase === 'walk') {
        if (state.stopwatch.walkStart === null) {
          state.stopwatch = { ...state.stopwatch, walkStart: now, walkSeconds: null };
          toast('Walk timing started — tap again when the guest presses the button.', 'info');
        } else {
          const seconds = Math.max(0, (now - state.stopwatch.walkStart) / 1000);
          state.stopwatch = { ...state.stopwatch, walkStart: null, walkSeconds: seconds };
          toast(`Walk: ${seconds.toFixed(1)}s. Carried into the journal below.`, 'ok');
        }
      } else if (state.stopwatch.shakeStart === null) {
        state.stopwatch = { ...state.stopwatch, shakeStart: now, shakeSeconds: null };
        toast('Shake timing started — tap again when the first ball leaves.', 'info');
      } else {
        const seconds = Math.max(0, (now - state.stopwatch.shakeStart) / 1000);
        state.stopwatch = { ...state.stopwatch, shakeStart: null, shakeSeconds: seconds };
        toast(`Shake: ${seconds.toFixed(1)}s. Carried into the journal below.`, 'ok');
      }
      startStopwatchTicker();
      render();
      break;
    }
    case 'sw-reset': {
      state.stopwatch = { walkStart: null, walkSeconds: null, shakeStart: null, shakeSeconds: null };
      render();
      break;
    }
    case 'toggle-drum-walk':
      state.lab = { ...state.lab, drumRunsDuringWalk: !state.lab.drumRunsDuringWalk };
      store.saveUi({ lab: state.lab });
      render();
      break;
    case 'journal-add': {
      const date = (document.getElementById('j-date') as HTMLInputElement | null)?.value ?? '';
      const walk = Number((document.getElementById('j-walk') as HTMLInputElement | null)?.value);
      const shake = Number((document.getElementById('j-shake') as HTMLInputElement | null)?.value);
      const first = Number((document.getElementById('j-first') as HTMLInputElement | null)?.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        toast('Pick the draw date first.', 'warn');
        return;
      }
      if (!Number.isFinite(walk) || walk < 0 || walk > 600) {
        toast('Walk time: seconds from being called to the press (0–600).', 'warn');
        return;
      }
      if (!Number.isInteger(first) || first < 1 || first > 90) {
        toast('First ball must be a whole number 1–90.', 'warn');
        return;
      }
      const entry: TimingEntry = {
        draw_date: date,
        walkSeconds: walk,
        shakeSeconds: Number.isFinite(shake) ? shake : 0,
        firstBall: first,
        game: state.game === 'all' ? undefined : state.game,
      };
      const next = [...state.journal.filter((e) => e.draw_date !== date), entry].sort((a, b) =>
        a.draw_date.localeCompare(b.draw_date)
      );
      state.journal = next;
      store.saveJournal(next);
      recompute();
      render();
      toast(`Logged ${next.length} timing${next.length === 1 ? '' : 's'}. ${next.length < 60 ? 'Keep going — 60+ before the test can say anything.' : ''}`, 'ok');
      break;
    }
    case 'journal-clear':
      state.journal = [];
      store.saveJournal([]);
      recompute();
      render();
      toast('Timing journal cleared in this browser.', 'info');
      break;
    case 'journal-export':
      if (!state.journal.length) {
        toast('Nothing to export yet.', 'warn');
        break;
      }
      store.downloadFile('nla-timings.csv', journalToCsv(state.journal), 'text/csv');
      break;
    case 'toggle-loading-known':
      state.lab = { ...state.lab, loadingKnown: !state.lab.loadingKnown };
      store.saveUi({ lab: state.lab });
      render();
      break;
    case 'toggle-advanced':
      state.advanced = !state.advanced;
      store.saveUi({ advanced: state.advanced });
      render();
      break;
    case 'reset-config':
      state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as EngineConfig;
      persistConfig();
      recompute();
      render();
      toast('Model weights reset to defaults.', 'ok');
      break;
    case 'import':
      await importFromTextarea();
      break;
    case 'paste-source':
      await pullSourceIntoTextarea();
      break;
    case 'export-json':
      exportAll('json');
      break;
    case 'export-csv':
      exportAll('csv');
      break;
    case 'clear-overlay':
      if (!state.overlay.length) {
        toast('No local draws to discard.', 'info');
        break;
      }
      if (window.confirm(`Discard ${state.overlay.length} local draw(s)? They exist only in this browser.`)) {
        state.overlay = [];
        store.saveOverlay([]);
        await reloadData();
        toast('Local draws discarded.', 'ok');
      }
      break;
    case 'wipe-local':
      if (window.confirm('Clear all settings (admin key, tokens, model weights) from this browser?')) {
        store.wipeLocal();
        state.settings = { ...store.DEFAULT_SETTINGS };
        state.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as EngineConfig;
        state.overlay = [];
        toast('Local storage cleared.', 'ok');
        render();
      }
      break;
    case 'delete-draw': {
      const date = el.dataset.date ?? '';
      if (!date || !window.confirm(`Delete the draw for ${date}?`)) break;
      if (state.mode === 'worker') {
        if (!state.settings.adminKey) {
          const entered = window.prompt('Enter your ADMIN_KEY to delete from D1:', '');
          if (!entered) break;
          state.settings.adminKey = entered.trim();
          store.saveSettings(state.settings);
        }
        const res = await fetch(`/api/draws?date=${encodeURIComponent(date)}`, {
          method: 'DELETE',
          headers: { 'x-api-key': state.settings.adminKey },
        });
        const data = await readJson(res);
        if (!res.ok) toast(`Delete failed: ${data.error ?? `HTTP ${res.status}`}`, 'bad');
        else await reloadData();
      } else {
        state.overlay = state.overlay.filter((d) => d.draw_date !== date);
        store.saveOverlay(state.overlay);
        state.draws = state.draws.filter((d) => d.draw_date !== date);
        recompute();
        render();
        toast('Removed from local storage. Built-in seed data can only be changed in data/draws.json.', 'info');
      }
      break;
    }
    case 'more-rows':
      state.ledgerLimit += 100;
      renderPanel();
      break;
    case 'save-settings': {
      const admin = (document.getElementById('s-admin') as HTMLInputElement | null)?.value ?? '';
      const source = (document.getElementById('s-source') as HTMLInputElement | null)?.value ?? '';
      const repo = (document.getElementById('s-repo') as HTMLInputElement | null)?.value ?? '';
      const token = (document.getElementById('s-token') as HTMLInputElement | null)?.value ?? '';
      state.settings = { adminKey: admin.trim(), sourceUrl: source.trim(), ghRepo: repo.trim(), ghToken: token.trim() };
      store.saveSettings(state.settings);
      toast('Settings saved in this browser.', 'ok');
      break;
    }
    case 'commit-github': {
      if (!state.overlay.length) {
        toast('No local draws to push. Add or import draws first.', 'warn');
        break;
      }
      state.busy = 'refresh';
      render();
      const result = await store.commitDrawsToGitHub(
        state.settings.ghRepo,
        state.settings.ghToken,
        state.overlay
      );
      state.busy = null;
      render();
      toast(result.message, result.ok ? 'ok' : 'bad');
      if (result.ok) {
        state.overlay = [];
        store.saveOverlay([]);
        await reloadData();
      }
      break;
    }
    case 'trigger-workflow': {
      state.busy = 'refresh';
      render();
      const result = await store.triggerRefreshWorkflow(state.settings.ghRepo, state.settings.ghToken);
      state.busy = null;
      render();
      toast(result.message, result.ok ? 'ok' : 'bad');
      break;
    }
    case 'dismiss-toast':
      state.toast = null;
      render();
      break;
    case 'reload':
      state.error = null;
      await boot();
      break;
    default:
      break;
  }
}

/* ==========================================================================
 * Boot
 * ========================================================================== */

async function boot(): Promise<void> {
  state.error = null;
  state.busy = null;
  const app = $('#app');
  if (app) {
    app.innerHTML = `<div class="flex min-h-screen items-center justify-center text-sm text-slate-400">
      <span class="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-transparent"></span>
      Loading NLA 5/90 history…
    </div>`;
  }
  try {
    state.mode = await detectMode();
    if (state.mode === 'static') state.health = { ok: true, mode: 'static', version: '1.8.1' };
    if (!state.settings.ghRepo.trim()) {
      const guess = repoGuess();
      if (guess) {
        state.settings.ghRepo = guess;
        store.saveSettings(state.settings);
      }
    }
    await loadDraws();
    recompute();
    applyRoute(true);
    if (!state.draws.length) {
      toast('No draws loaded. Import results in the Ledger tab, or check data/draws.json.', 'warn');
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

bindEvents();
void boot();

/* Exposed for debugging in the console; harmless in production. */
declare global {
  interface Window {
    NLA?: { state: AppState; recompute: () => void; render: () => void };
  }
}
window.NLA = { state, recompute, render };
