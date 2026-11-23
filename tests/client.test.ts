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

    // Wait for the real boot sequence: data loaded → deduction rendered.
    await waitFor(() => Boolean(state()?.deduction), 'engine to produce a deduction');
    await waitFor(() => appText().includes("Today's three deduced candidates"), 'deduction tab to render');
  }, 60_000);

  it('renders the deduction tab with three picks', () => {
    const app = document.getElementById('app')!;
    const text = appText();
    expect(text).toContain('Ghana NLA 5/90');
    expect(app.querySelectorAll('.pick-ball').length).toBe(3);
    expect(text).toContain('Combinatorial audit');
    expect(text).toContain('Plain-English justifications');
    expect(app.querySelectorAll('details').length).toBeGreaterThanOrEqual(3);
  });

  it('exposes the live state for debugging', () => {
    const s = state();
    expect(s.mode).toBe('static');
    expect(s.draws.length).toBeGreaterThanOrEqual(60);
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
    for (const tab of ['deduce', 'ledger', 'settings']) {
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
});
