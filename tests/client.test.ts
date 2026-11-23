// @vitest-environment jsdom
/**
 * End-to-end-ish smoke test: boots the real dashboard bundle entry against a
 * fake static host (data/draws.json) and drives the tabs like a user would.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import seed from '../data/draws.json';

const draws = seed as Array<{ draw_date: string; game_name: string; winning: number[]; machine: number[] }>;

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

const flush = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

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
    await flush(150);
  });

  it('renders the deduction tab with three picks', () => {
    const app = document.getElementById('app')!;
    const text = app.textContent ?? '';
    expect(text).toContain('Ghana NLA 5/90');
    expect(text).toContain("Today's three deduced candidates");
    expect(app.querySelectorAll('.pick-ball').length).toBe(3);
    expect(text).toContain('Combinatorial audit');
    expect(text).toContain('Plain-English justifications');
    expect(app.querySelectorAll('details').length).toBeGreaterThanOrEqual(3);
  });

  it('exposes the live state for debugging', () => {
    const state = (window as any).NLA.state;
    expect(state.mode).toBe('static');
    expect(state.draws.length).toBeGreaterThanOrEqual(60);
    expect(state.deduction.top).toHaveLength(3);
    expect(state.deduction.trio.numbers).toHaveLength(3);
  });

  it('switches to the ledger tab and renders the history table', async () => {
    const ledgerTab = document.querySelector<HTMLElement>('[data-action="tab"][data-tab="ledger"]')!;
    ledgerTab.click();
    await flush();
    const text = document.getElementById('app')!.textContent ?? '';
    expect(text).toContain('Historical ledger');
    expect(text).toContain('Add a draw manually');
    expect(document.querySelectorAll('#panel tbody tr').length).toBeGreaterThan(10);
  });

  it('runs the walk-forward backtest and shows the edge audit', async () => {
    const state = (window as any).NLA.state;
    state.backtestOpts = { minTrain: 25, simulations: 20 };
    const backtestTab = document.querySelector<HTMLElement>('[data-action="tab"][data-tab="backtest"]')!;
    backtestTab.click();
    await flush(1200);
    const text = document.getElementById('app')!.textContent ?? '';
    expect(text).toContain('1-Number hit');
    expect(text).toContain('2-Sure (both hit)');
    expect(text).toContain('3-Direct (trio hits)');
    expect(text).toContain('Edge audit');
    expect(text).toContain('Step-by-step audit table');
    expect((window as any).NLA.state.backtest.runs.length).toBeGreaterThan(10);
  });

  it('renders the data/settings tab', async () => {
    const settingsTab = document.querySelector<HTMLElement>('[data-action="tab"][data-tab="settings"]')!;
    settingsTab.click();
    await flush();
    const text = document.getElementById('app')!.textContent ?? '';
    expect(text).toContain('GitHub-only sync');
    expect(text).toContain('How this app is honest with you');
  });

  it('never leaks undefined, NaN or [object Object] into the DOM', async () => {
    for (const tab of ['deduce', 'ledger', 'settings']) {
      document.querySelector<HTMLElement>(`[data-action="tab"][data-tab="${tab}"]`)!.click();
      await flush(150);
      const html = document.getElementById('app')!.innerHTML;
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('[object Object]');
    }
  });

  it('is safe against HTML injection from a draw name', async () => {
    const state = (window as any).NLA.state;
    state.draws = [
      ...state.draws,
      {
        draw_date: '2027-01-02',
        game_name: '<img src=x onerror=alert(1)>',
        winning: [1, 2, 3, 4, 5],
        machine: [6, 7, 8, 9, 10],
      },
    ];
    document.querySelector<HTMLElement>('[data-action="tab"][data-tab="ledger"]')!.click();
    await flush();
    const app = document.getElementById('app')!;
    expect(app.querySelectorAll('img[src="x"]').length).toBe(0);
    expect(app.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
