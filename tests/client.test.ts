// @vitest-environment jsdom
/**
 * End-to-end-ish smoke test: boots the real dashboard bundle entry against a
 * fake static host (data/draws.json) and drives the tabs like a user would.
 *
 * Every wait polls for a concrete condition instead of sleeping a fixed number
 * of milliseconds — CI runners are much slower than a laptop on first paint,
 * and fixed sleeps make this class of test flaky for no benefit.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import seed from '../data/draws.json';

const draws = seed as Array<{ draw_date: string; game_name: string; winning: number[]; machine: number[] }>;

const TIMEOUT = 20_000;

/** Poll until `predicate` holds (or fail with a useful message). */
async function waitFor(predicate: () => boolean, label: string, timeout = TIMEOUT): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (predicate()) return;
    } catch {
      /* DOM not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`waitFor timed out after ${timeout}ms: ${label}`);
}

const appText = (): string => document.getElementById('app')?.textContent ?? '';
const appHtml = (): string => document.getElementById('app')?.innerHTML ?? '';
const state = (): any => (globalThis as any).window.NLA?.state;

/** Click a control and wait for the panel to react. */
async function click(selector: string): Promise<void> {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Control not found: ${selector}`);
  el.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installFetchStub(): void {
  const stub = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/api/health')) {
      // Simulate GitHub Pages: no API at all.
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('draws.json')) {
      return new Response(JSON.stringify(draws), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  };
  globalThis.fetch = stub as typeof fetch;
}

describe('dashboard (static mode)', () => {
  beforeAll(async () => {
    if (!('timeout' in AbortSignal)) {
      // jsdom may not implement AbortSignal.timeout
      (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      };
    }
    document.body.innerHTML = '<div id="app"></div>';
    installFetchStub();
    await import('../src/client/main');

    // Wait for the real boot sequence: data loaded → the public home page.
    await waitFor(() => Boolean(state()?.deduction), 'engine to produce a deduction');
    await waitFor(() => appText().includes('The draw is random'), 'home page to render');
    // The tool is a section now, not the front door: open it, then pick a tab.
    await click('a[data-action="goto"][data-page="tools"]');
    await waitFor(() => Boolean(document.querySelector('[data-action="tab"][data-tab="deduce"]')), 'tool tabs');
    await click('[data-action="tab"][data-tab="deduce"]');
    await waitFor(() => /(Tonight's|Next) draw — /.test(appText()), 'deduction tab to render');
  }, 60_000);

  it('renders the deduction tab with three picks', () => {
    const app = document.getElementById('app')!;
    const text = appText();
    expect(text).toContain('Ghana NLA 5/90');
    expect(app.querySelectorAll('.pick-ball').length).toBe(3);
    // The heading names the game the picks are actually for — never "today's".
    expect(text).toMatch(/(Tonight's|Next) draw — /);
    expect(text).not.toContain("Today's three");
    expect(text).toMatch(/drawing/);
    expect(text).toContain('Combinatorial audit');
    expect(text).toContain('Plain-English justifications');
    expect(app.querySelectorAll('details').length).toBeGreaterThanOrEqual(3);
  });

  it('shows what the engine said before the last draw', async () => {
    await click('[data-action="tab"][data-tab="deduce"]');
    await waitFor(() => appText().includes('Last draw vs the engine'), 'review card');
    expect(state().review).toBeTruthy();
    expect(appText()).toContain('Engine said');
    expect(appText()).toMatch(/expected 0\.17 per draw/);
    expect(appText()).toContain('Pre-draw rank');
    // Honest wording: a blank line is the normal outcome, not a failure.
    expect(appText()).toMatch(/most likely outcome/i);
  });

  it('defaults to the game drawn today', () => {
    const wd = new Date().getUTCDay();
    const todayGame =
      ['', 'Monday Special', 'Lucky Tuesday', 'Midweek', 'Fortune Thursday', 'Friday Bonanza', 'National Weekly'][wd] || 'all';
    expect(state().game).toBe(todayGame);
    if (todayGame !== 'all') {
      // The target is that game's own next draw, not whichever game comes next.
      expect(state().deduction.next.game).toBe(todayGame);
      expect(appText()).toContain(todayGame);
      expect(appText()).toContain('— today');
    }
  });

  it('exposes the live state for debugging', () => {
    const s = state();
    expect(s.mode).toBe('static');
    expect(s.draws.length).toBeGreaterThanOrEqual(60);
    // No draw may be dated in the future, whatever the JSON says.
    const today = new Date().toISOString().slice(0, 10);
    expect(s.draws.every((d: { draw_date: string }) => d.draw_date <= today)).toBe(true);
    expect(s.deduction.top).toHaveLength(3);
    expect(s.deduction.trio.numbers).toHaveLength(3);
  });

  it('switches to the ledger tab and renders the history table', async () => {
    await click('[data-action="tab"][data-tab="ledger"]');
    await waitFor(() => appText().includes('Historical ledger'), 'ledger tab to render');
    expect(appText()).toContain('Add a draw manually');
    await waitFor(
      () => document.querySelectorAll('#panel tbody tr').length > 10,
      'ledger rows to populate'
    );
  });

  it('runs the walk-forward backtest and shows the edge audit', async () => {
    // Keep the simulation small: this test asserts wiring, not statistics.
    // Pool all six games — a single game only has ~10 draws, far too few for
    // this assertion to mean anything.
    state().game = 'all';
    (window as unknown as { NLA: { recompute: () => void } }).NLA.recompute();
    state().backtestOpts = { minTrain: 25, simulations: 20 };
    await click('[data-action="tab"][data-tab="backtest"]');
    await waitFor(() => Boolean(state()?.backtest), 'backtest to finish', 40_000);
    await waitFor(() => appText().includes('Edge audit'), 'backtest view to render');
    const text = appText();
    expect(text).toContain('1-Number hit');
    expect(text).toContain('2-Sure (both hit)');
    expect(text).toContain('3-Direct (trio hits)');
    expect(text).toContain('Step-by-step audit table');
    expect(state().backtest.runs.length).toBeGreaterThan(10);
  });

  it('renders the data/settings tab', async () => {
    await click('[data-action="tab"][data-tab="settings"]');
    await waitFor(() => appText().includes('GitHub-only sync'), 'settings tab to render');
    expect(appText()).toContain('How this app is honest with you');
  });

  it('keeps the maths behind the scenes until asked', async () => {
    await click('[data-action="tab"][data-tab="deduce"]');
    await waitFor(() => appText().includes('Show the maths'), 'simple mode affordance');
    // The 90-number ranking and model-state panel are opt-in.
    expect(appText()).not.toContain('Full pillar ranking');
    expect(appText()).not.toContain('Score entropy');
    // Plain English and the five-number line are always visible.
    expect(appText()).toContain('Plain-English justifications');
    expect(appText()).toContain('The full five-number line');

    await click('[data-action="toggle-advanced"]');
    await waitFor(() => appText().includes('Full pillar ranking'), 'maths revealed');
    expect(appText()).toContain('Score entropy');
    await click('[data-action="toggle-advanced"]');
    await waitFor(() => !appText().includes('Full pillar ranking'), 'maths hidden again');
  });

  it('shows which NLA ticket loses least in the draw lab', async () => {
    await click('[data-action="tab"][data-tab="lab"]');
    await waitFor(() => appText().includes('What each NLA bet actually returns'), 'bet board');
    expect(appText()).toContain('Direct 2');
    expect(appText()).toContain('44,000×');
    expect(appText()).toMatch(/best: Direct 2 at 60%/);
    // The five types are ranked, and the worst is called out.
    expect(appText()).toContain('0.10%');
  });

  it('tests the first ball against the archive instead of assuming', async () => {
    await click('[data-action="tab"][data-tab="lab"]');
    await waitFor(() => appText().includes('Is the first ball biased?'), 'first-ball card');
    expect(state().order).toBeTruthy();
    expect(state().order.draws).toBe(state().draws.length);
    expect(appText()).toContain('Chi-square');
    expect(appText()).toMatch(/consistent with a fair drum|unusual skew/i);
    expect(appText()).toContain('df = 89');
  });

  it('lets the drum-timing sliders change the verdict', async () => {
    await click('[data-action="tab"][data-tab="lab"]');
    await waitFor(() => Boolean(document.getElementById('lab-shake')), 'shake slider');
    const slider = document.getElementById('lab-shake') as HTMLInputElement;
    slider.value = '0.4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => state().lab.shakeSeconds === 0.4, 'slider state persisted');
    expect(appText()).toMatch(/under-mixed/i);
    // A very short shake would make Direct 1 beatable — with a known loading order.
    expect(appText()).toMatch(/per 1\.00/);
  });

  it('removes the edge entirely when the drum is sealed', async () => {
    await click('[data-action="tab"][data-tab="lab"]');
    await waitFor(() => appText().includes('sealed drum') || appText().includes('assuming you know'), 'toggle present');
    if (!state().lab.loadingKnown) {
      await click('[data-action="toggle-loading-known"]');
      await waitFor(() => state().lab.loadingKnown, 'loading known on');
    }
    await click('[data-action="toggle-loading-known"]');
    await waitFor(() => !state().lab.loadingKnown, 'sealed drum');
    expect(appText()).toContain('sealed drum');
    expect(appText()).toMatch(/1 in 90/);
    // Restore for other tests.
    await click('[data-action="toggle-loading-known"]');
  });

  it('models the guest walking to the button — as mixing, not as a signal', async () => {
    await click('[data-action="tab"][data-tab="lab"]');
    await waitFor(() => appText().includes('The guest who presses the button'), 'guest card');
    expect(appText()).toContain('Collisions per ball');
    expect(state().lab.walkSeconds).toBeGreaterThan(0);

    const slider = document.getElementById('lab-walk') as HTMLInputElement;
    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => state().lab.walkSeconds === 40, 'walk slider persisted');
    // More walking means more mixing, and the copy says so.
    expect(appText()).toMatch(/more mixing than the drum needs/i);

    // With the drum stopped, the walk changes nothing at all.
    await click('[data-action="toggle-drum-walk"]');
    await waitFor(() => !state().lab.drumRunsDuringWalk, 'drum stopped');
    expect(appText()).toMatch(/nothing new becomes observable/i);
    await click('[data-action="toggle-drum-walk"]');
  });

  it('logs timings and runs the journal test on them', async () => {
    await click('[data-action="tab"][data-tab="lab"]');
    await waitFor(() => Boolean(document.getElementById('j-walk')), 'journal form');

    for (let i = 1; i <= 10; i++) {
      (document.getElementById('j-date') as HTMLInputElement).value = `2026-10-${String(i).padStart(2, '0')}`;
      (document.getElementById('j-walk') as HTMLInputElement).value = String(6 + (i % 7));
      (document.getElementById('j-shake') as HTMLInputElement).value = '5';
      (document.getElementById('j-first') as HTMLInputElement).value = String(1 + i * 7);
      await click('[data-action="journal-add"]');
    }
    await waitFor(() => state().journal.length === 10, 'ten timings logged');
    expect(state().journalReport).toBeTruthy();
    expect(state().journalReport.entries).toBe(10);
    await waitFor(() => appText().includes("Cramér's V"), 'journal test rendered');
    expect(appText()).toMatch(/Inconclusive by design|No detectable link/i);
    // The summary table reflects the logged rows.
    expect(appText()).toContain('Mean first ball');
  });

  it('labels the refresh control honestly on a static host', async () => {
    await click('[data-action="tab"][data-tab="deduce"]');
    await waitFor(() => appText().includes('Refresh via GitHub'), 'static refresh label');
    expect(appText()).not.toContain('Refresh Latest Results');
  });

  it('sends a static refresh to GitHub instead of a doomed cross-origin fetch', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(typeof input === 'string' ? input : String((input as Request).url ?? input));
      return original(input as RequestInfo, init);
    }) as typeof fetch;
    try {
      await click('[data-action="refresh"]');
      await waitFor(() => appText().includes('runs on GitHub'), 'guidance toast');
      // It never tries to read the results site directly (that only produces a
      // console CORS error), and it never calls the GitHub API without a token.
      expect(calls.some((u) => u.includes('24lottos'))).toBe(false);
      expect(calls.some((u) => u.includes('api.github.com'))).toBe(false);
      // It lands on the tab that holds the controls which actually work.
      expect(state().view).toBe('settings');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('links to the workflow page and the token form', async () => {
    const repo = state().settings.ghRepo;
    state().settings.ghRepo = 'Obed-Cudjoe/NLA-LOTTO';
    try {
      await click('[data-action="tab"][data-tab="settings"]');
      await waitFor(
        () => Boolean(document.querySelector('a[href*="actions/workflows/refresh-draws.yml"]')),
        'workflow deep link'
      );
      const link = document.querySelector<HTMLAnchorElement>('a[href*="actions/workflows/refresh-draws.yml"]');
      expect(link?.href).toBe(
        'https://github.com/Obed-Cudjoe/NLA-LOTTO/actions/workflows/refresh-draws.yml'
      );
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(document.querySelector('a[href*="personal-access-tokens/new"]')).not.toBeNull();
    } finally {
      state().settings.ghRepo = repo;
    }
  });

  it('dispatches the workflow when a token is configured', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
      calls.push(url);
      if (url.includes('api.github.com')) return new Response('{}', { status: 500 });
      return original(input as RequestInfo, init);
    }) as typeof fetch;
    const repo = state().settings.ghRepo;
    const token = state().settings.ghToken;
    state().settings.ghRepo = 'Obed-Cudjoe/NLA-LOTTO';
    state().settings.ghToken = 'github_pat_test';
    try {
      await click('[data-action="refresh"]');
      await waitFor(() => calls.some((u) => u.includes('/dispatches')), 'workflow dispatch call');
      expect(calls.some((u) => u.endsWith('/actions/workflows/refresh-draws.yml/dispatches'))).toBe(true);
      await waitFor(
        () => /GitHub API responded 500|Could not dispatch/.test(appText()),
        'dispatch failure surfaced'
      );
    } finally {
      globalThis.fetch = original;
      state().settings.ghRepo = repo;
      state().settings.ghToken = token;
    }
  });

  it('never leaks undefined, NaN or [object Object] into the DOM', async () => {
    for (const tab of ['deduce', 'lab', 'ledger', 'settings']) {
      await click(`[data-action="tab"][data-tab="${tab}"]`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const html = appHtml();
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('[object Object]');
    }
  });

  it('is safe against HTML injection from a draw name', async () => {
    state().draws = [
      ...state().draws,
      {
        draw_date: '2027-01-02',
        game_name: '<img src=x onerror=alert(1)>',
        winning: [1, 2, 3, 4, 5],
        machine: [6, 7, 8, 9, 10],
      },
    ];
    await click('[data-action="tab"][data-tab="ledger"]');
    await waitFor(() => appText().includes('2027-01-02'), 'injected draw row to render');
    const app = document.getElementById('app')!;
    expect(app.querySelectorAll('img[src="x"]').length).toBe(0);
    expect(app.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('lands on a home page that reads like a website, not an instrument panel', async () => {
    await click('[data-action="goto"][data-page="home"]');
    await waitFor(() => appText().includes('The draw is random'), 'home hero');

    expect(window.location.hash).toBe('#/');
    // Sections are real links.
    expect(document.querySelectorAll('.nav-link').length).toBeGreaterThanOrEqual(12);
    expect(document.querySelectorAll('.feature-card').length).toBe(4);
    // Marketing copy, not model internals.
    expect(appText()).toContain('Results archive');
    expect(appText()).toContain('Ticket arithmetic');
    expect(appText()).toContain('What we won\'t tell you');
    expect(appText()).not.toContain('Full pillar ranking');
    expect(appText()).not.toContain('Score entropy');
    expect(appText()).not.toContain('Markov shrinkage');
    // The next draw still shows real numbers, plainly.
    expect(document.querySelectorAll('.hero-ball').length).toBe(5);
  });

  it('gives every section its own address', async () => {
    await click('[data-action="goto"][data-page="games"]');
    await waitFor(() => appText().includes('Six games, one a day'), 'games page');
    expect(window.location.hash).toBe('#/games');
    for (const game of ['Monday Special', 'Lucky Tuesday', 'Midweek', 'Fortune Thursday', 'Friday Bonanza', 'National Weekly']) {
      expect(appText()).toContain(game);
    }

    await click('[data-action="goto"][data-page="smart"]');
    await waitFor(() => appText().includes('Every ticket loses money'), 'play-smart page');
    expect(window.location.hash).toBe('#/smart');
    expect(appText()).toContain('Direct 2');
    expect(appText()).toContain('House keeps');
    expect(appText()).toContain('Coverage buys odds, not edge');

    await click('[data-action="goto"][data-page="results"]');
    await waitFor(() => appText().includes('Every draw we hold'), 'results page');
    expect(window.location.hash).toBe('#/results');

    await click('[data-action="goto"][data-page="method"]');
    await waitFor(() => appText().includes('The first-ball test'), 'method page');
    expect(window.location.hash).toBe('#/method');
    expect(appText()).toMatch(/consistent with a fair drum|unusual skew/);
    expect(appText()).toContain('What would change our mind');
  });

  it('keeps the working bench behind the tool door', async () => {
    await click('[data-action="goto"][data-page="home"]');
    await waitFor(() => appText().includes('The draw is random'), 'home again');
    await click('[data-action="goto"][data-page="tools"]');
    await waitFor(() => appText().includes('This is the working bench'), 'tool page');
    // The sliders, the game filter and the tab strip only exist in here.
    expect(document.getElementById('game-select')).toBeTruthy();
    expect(document.querySelectorAll('.tab').length).toBe(5);
    expect(window.location.hash.startsWith('#/tools')).toBe(true);
  });

  it('switches game from the public chips without the control bar', async () => {
    await click('[data-action="goto"][data-page="tonight"]');
    await waitFor(() => appText().includes('Tonight'), 'tonight page');
    expect(document.getElementById('game-select')).toBeNull();
    await click('[data-action="pick-game"][data-game="Friday Bonanza"]');
    await waitFor(() => state().game === 'Friday Bonanza', 'game switched by chip');
    expect(appText()).toContain('Friday Bonanza');
  });

  it('never leaks undefined, NaN or [object Object] into any site page', async () => {
    for (const page of ['home', 'tonight', 'results', 'games', 'smart', 'method']) {
      await click(`[data-action="goto"][data-page="${page}"]`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const text = appText();
      expect(text.length, `${page} rendered something`).toBeGreaterThan(200);
      expect(text, `${page} has no broken interpolation`).not.toMatch(/undefined|NaN|\[object Object\]/);
      // No invented contact details: a made-up helpline number is as dishonest
      // as a made-up statistic, so the site must not print one at all.
      expect(text, `${page} invents no phone number`).not.toMatch(/\b0\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}\b/);
    }
  });

  it('times a real broadcast with the stopwatch and carries it into the journal', async () => {
    await click('[data-action="goto"][data-page="tools"]');
    await waitFor(() => Boolean(document.querySelector('[data-action="tab"][data-tab="lab"]')), 'tool tabs');
    await click('[data-action="tab"][data-tab="lab"]');
    await waitFor(() => appText().includes('Time the draw yourself'), 'stopwatch card');

    // Start the walk, backdate the mark by 13.4s, then stop it as a user would.
    await click('[data-action="sw-tap"][data-phase="walk"]');
    expect(state().stopwatch.walkStart).toBeTypeOf('number');
    state().stopwatch.walkStart = performance.now() - 13_400;
    await click('[data-action="sw-tap"][data-phase="walk"]');

    const walk = state().stopwatch.walkSeconds as number;
    expect(walk).toBeGreaterThan(13);
    expect(walk).toBeLessThan(14);
    expect(appText()).toContain('Walk: 13.');

    // Same for the shake.
    await click('[data-action="sw-tap"][data-phase="shake"]');
    state().stopwatch.shakeStart = performance.now() - 6_200;
    await click('[data-action="sw-tap"][data-phase="shake"]');
    const shake = state().stopwatch.shakeSeconds as number;
    expect(shake).toBeGreaterThan(6);
    expect(shake).toBeLessThan(7);

    // The journal form is prefilled, so logging is one tap.
    await waitFor(() => appText().includes('Timing journal'), 'journal card');
    const jWalk = document.getElementById('j-walk') as HTMLInputElement;
    const jShake = document.getElementById('j-shake') as HTMLInputElement;
    expect(Number(jWalk.value)).toBeCloseTo(walk, 1);
    expect(Number(jShake.value)).toBeCloseTo(shake, 1);

    (document.getElementById('j-first') as HTMLInputElement).value = '34';
    const before = state().journal.length;
    await click('[data-action="journal-add"]');
    await waitFor(() => state().journal.length === before + 1, 'timing logged from the stopwatch');
    expect(state().journal[state().journal.length - 1].walkSeconds).toBeCloseTo(walk, 1);
  });
});
