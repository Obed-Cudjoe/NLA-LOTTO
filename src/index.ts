/**
 * ---------------------------------------------------------------------------
 * Cloudflare Worker entry point
 * ---------------------------------------------------------------------------
 * Serves the JSON API and the daily cron refresh. The dashboard itself is a
 * static single-page app in ./public, deployed as part of this same Worker
 * (Workers Static Assets), so one `wrangler deploy` ships both the UI and API.
 *
 * API surface
 *   GET    /api/health                      liveness + inventory
 *   GET    /api/draws?game=&limit=&format=  draw history (json|csv)
 *   GET    /api/analysis?game=&lookback=…   full four-pillar deduction
 *   GET    /api/backtest?game=&minTrain=…   walk-forward simulation + edge audit
 *   GET    /api/export                      full JSON backup
 *   POST   /api/refresh                     scrape RESULTS_SOURCE_URL   (x-api-key)
 *   POST   /api/draws                       manual / bulk JSON or CSV   (x-api-key)
 *   DELETE /api/draws?date=YYYY-MM-DD       remove one draw             (x-api-key)
 *
 * Cron: "0 21 * * *" — after all six evening draws have settled.
 */
import {
  DEFAULT_CONFIG,
  GAMES,
  backtest as runBacktest,
  deduce,
  drawToRow,
  filterByGame,
  formatDrawDate,
  nextDrawAfter,
  normalizeHistory,
  parseCsv,
  rowToDraw,
  validateDraw,
  type Draw,
  type EngineConfig,
  type PillarWeights,
} from './mathEngine';
import { countDraws, deleteDrawByDate, ensureSchema, insertDraws, latestDraw, listDrawRows } from './db';
import { fetchAndParse, parsePayload, summariseParsed } from './scraper';
import seedData from '../data/draws.json';

export interface Env {
  DB: D1Database;
  /** Shared secret for write endpoints. Set with: npx wrangler secret put ADMIN_KEY */
  ADMIN_KEY?: string;
  /** Page scraped by the cron trigger and by POST /api/refresh. */
  RESULTS_SOURCE_URL?: string;
  /** Game assumed when a source does not name one. */
  DEFAULT_GAME?: string;
  ASSETS?: Fetcher;
}

const VERSION = '1.12.0';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-api-key, authorization',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });

const errorJson = (message: string, status = 400, extra: Record<string, unknown> = {}): Response =>
  json({ ok: false, error: message, ...extra }, status);

/* ==========================================================================
 * Auth
 * ========================================================================== */

/** Constant-time-ish string comparison (length check + XOR accumulate). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorised(req: Request, env: Env): { ok: boolean; reason?: string } {
  if (!env.ADMIN_KEY) {
    return {
      ok: false,
      reason:
        'ADMIN_KEY is not configured on this Worker. Run: npx wrangler secret put ADMIN_KEY — then redeploy.',
    };
  }
  const header = req.headers.get('x-api-key') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const provided = header || bearer;
  if (!provided) return { ok: false, reason: 'Missing x-api-key header.' };
  if (!safeEqual(provided, env.ADMIN_KEY)) return { ok: false, reason: 'Invalid API key.' };
  return { ok: true };
}

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

function numParam(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolParam(url: URL, key: string, fallback: boolean): boolean {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

export function configFromQuery(url: URL): EngineConfig {
  const weights: PillarWeights = {
    bayes: numParam(url, 'wb', DEFAULT_CONFIG.weights.bayes),
    poisson: numParam(url, 'wp', DEFAULT_CONFIG.weights.poisson),
    markov: numParam(url, 'wm', DEFAULT_CONFIG.weights.markov),
  };
  return {
    ...DEFAULT_CONFIG,
    lookback: Math.max(5, Math.min(500, numParam(url, 'lookback', DEFAULT_CONFIG.lookback))),
    weights,
    poolSize: Math.max(3, Math.min(40, numParam(url, 'pool', DEFAULT_CONFIG.poolSize))),
    bayesPriorStrength: Math.max(0.5, numParam(url, 'prior', DEFAULT_CONFIG.bayesPriorStrength)),
    markovAlpha: Math.max(0, numParam(url, 'alpha', DEFAULT_CONFIG.markovAlpha)),
    markovMachineWeight: Math.max(0, Math.min(1, numParam(url, 'machine', DEFAULT_CONFIG.markovMachineWeight))),
    expectedGap: Math.max(2, numParam(url, 'gap', DEFAULT_CONFIG.expectedGap)),
    filters: {
      decadeSpread: boolParam(url, 'decade', true),
      parityBalance: boolParam(url, 'parity', true),
      sumRange: boolParam(url, 'sumrange', true),
      minSum: numParam(url, 'minsum', DEFAULT_CONFIG.filters.minSum),
      maxSum: numParam(url, 'maxsum', DEFAULT_CONFIG.filters.maxSum),
    },
  };
}

async function loadHistory(env: Env, game?: string | null): Promise<Draw[]> {
  const rows = await listDrawRows(env.DB, { limit: 5000, ascending: true });
  return normalizeHistory(filterByGame(rows.map(rowToDraw), game));
}

/* ==========================================================================
 * Refresh (shared by POST /api/refresh and the cron trigger)
 * ========================================================================== */

export interface RefreshOptions {
  url?: string | null;
  game?: string | null;
  dryRun?: boolean;
  source?: string;
}

export interface RefreshOutcome {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export async function runRefresh(env: Env, opts: RefreshOptions = {}): Promise<RefreshOutcome> {
  const url = (opts.url ?? env.RESULTS_SOURCE_URL ?? '').trim();
  if (!url) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error:
          'No results source configured. Set RESULTS_SOURCE_URL in wrangler.toml ([vars]) or pass ?url=https://… to this endpoint.',
      },
    };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, status: 400, body: { ok: false, error: `RESULTS_SOURCE_URL is not a valid URL: ${url}` } };
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return { ok: false, status: 400, body: { ok: false, error: 'Only http(s) sources are supported.' } };
  }

  const parsed = await fetchAndParse(url, {
    defaultGame: opts.game ?? env.DEFAULT_GAME ?? 'Monday Special',
    today: new Date().toISOString().slice(0, 10),
  });

  const base = {
    ok: parsed.draws.length > 0,
    source: url,
    fetched: parsed.fetch,
    strategies: parsed.strategies,
    parsed: parsed.draws.length,
    summary: summariseParsed(parsed),
    warnings: parsed.warnings.slice(0, 25),
    errors: parsed.errors.slice(0, 25),
    dryRun: Boolean(opts.dryRun),
  };

  if (!parsed.draws.length) {
    return { ok: false, status: 422, body: { ...base, error: parsed.errors[0] ?? 'No draws found at source.' } };
  }

  if (opts.dryRun) {
    return { ok: true, status: 200, body: { ...base, draws: parsed.draws } };
  }

  const result = await insertDraws(env.DB, parsed.draws, opts.source ?? 'scraper');
  return {
    ok: true,
    status: 200,
    body: {
      ...base,
      inserted: result.inserted,
      skipped: result.skipped,
      insertedDates: result.insertedDates,
      latest: parsed.draws[0]?.draw_date ?? null,
    },
  };
}

/* ==========================================================================
 * POST /api/draws  — manual / bulk import
 * ========================================================================== */

interface ImportOutcome {
  inserted: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  accepted: number;
}

async function handleImport(req: Request, env: Env): Promise<Response> {
  const contentType = req.headers.get('content-type') ?? '';
  const raw = await req.text();
  if (!raw.trim()) return errorJson('Request body is empty. Send JSON or CSV draws.');

  let draws: Draw[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const isCsv =
    /csv|text\/plain/i.test(contentType) || (!raw.trim().startsWith('{') && !raw.trim().startsWith('['));

  if (!isCsv) {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return errorJson(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { draws?: unknown[] })?.draws)
        ? ((payload as { draws: unknown[] }).draws as unknown[])
        : [(payload as { draw?: unknown })?.draw ?? payload];

    for (const [i, item] of items.entries()) {
      const result = validateDraw(item);
      if (result.ok && result.draw) draws.push(result.draw);
      else errors.push(`item ${i + 1}: ${result.errors.join('; ')}`);
    }
  } else {
        const parsed = parseCsv(raw);
    draws = parsed.rows;
    errors.push(...parsed.errors);
  }

  if (!draws.length) {
    return errorJson('No valid draws in request body.', 422, { errors, warnings });
  }

  const result = await insertDraws(env.DB, draws, 'manual');
  return json({
    ok: true,
    accepted: draws.length,
    inserted: result.inserted,
    skipped: result.skipped,
    insertedDates: result.insertedDates,
    skippedDates: result.skippedDates,
    errors,
    warnings,
  });
}

/* ==========================================================================
 * Router
 * ========================================================================== */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (!path.startsWith('/api/')) {
      // Static assets normally handle this; this branch only runs if the
      // assets directory was not deployed.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response(
        'Dashboard assets not found. Run `npm run build` before deploying, or open /api/health.',
        { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }
      );
    }

    try {
      /* ---------------------------- health ---------------------------- */
      if (path === '/api/health' && method === 'GET') {
        let total = 0;
        let latest: string | null = null;
        let game: string | null = null;
        let dbError: string | null = null;
        try {
          total = await countDraws(env.DB);
          const row = await latestDraw(env.DB);
          latest = row?.draw_date ?? null;
          game = row?.game_name ?? null;
        } catch (err) {
          dbError = err instanceof Error ? err.message : String(err);
        }
        return json({
          ok: !dbError,
          service: 'ghana-nla-5-90-engine',
          mode: 'worker',
          version: VERSION,
          games: GAMES,
          draws: total,
          latest: latest ? { date: latest, game, label: formatDrawDate(latest) } : null,
          next: latest ? nextDrawAfter(latest) : null,
          hasAdminKey: Boolean(env.ADMIN_KEY),
          hasSourceUrl: Boolean(env.RESULTS_SOURCE_URL),
          time: new Date().toISOString(),
          ...(dbError ? { dbError } : {}),
        });
      }

      /* ---------------------------- draws ----------------------------- */
      if (path === '/api/draws' && method === 'GET') {
        const game = url.searchParams.get('game');
        const limit = Math.max(1, Math.min(5000, numParam(url, 'limit', 2000)));
        const rows = await listDrawRows(env.DB, { game, limit, ascending: true });
        const draws = rows.map(rowToDraw);

        if (url.searchParams.get('format') === 'csv') {
          const header = 'date,game,num1,num2,num3,num4,num5,mac1,mac2,mac3,mac4,mac5';
          const lines = draws.map((d) =>
            [d.draw_date, d.game_name, ...d.winning, ...d.machine].join(',')
          );
          return new Response([header, ...lines].join('\n'), {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'cache-control': 'no-store',
              'content-disposition': 'attachment; filename="nla-5-90-draws.csv"',
            },
          });
        }

        return json({ ok: true, count: draws.length, draws, rows });
      }

      /* --------------------------- analysis --------------------------- */
      if (path === '/api/analysis' && method === 'GET') {
        const game = url.searchParams.get('game');
        const history = await loadHistory(env, game);
        if (!history.length) return errorJson('No draws stored yet. Seed D1 or POST /api/draws.', 409);
        const config = configFromQuery(url);
        const deduction = deduce(history, config);
        return json({ ok: true, game: game ?? 'all', config, deduction });
      }

      /* --------------------------- backtest --------------------------- */
      if (path === '/api/backtest' && method === 'GET') {
        const game = url.searchParams.get('game');
        const history = await loadHistory(env, game);
        if (!history.length) return errorJson('No draws stored yet. Seed D1 or POST /api/draws.', 409);
        const config = configFromQuery(url);
        const minTrain = Math.max(10, numParam(url, 'minTrain', 20));
        const simulations = Math.max(0, Math.min(2000, numParam(url, 'simulations', 300)));
        const result = runBacktest(history, config, { minTrain, game: null, simulations });
        return json({ ok: true, game: game ?? 'all', ...result });
      }

      /* ---------------------------- export ---------------------------- */
      if (path === '/api/export' && method === 'GET') {
        const rows = await listDrawRows(env.DB, { limit: 5000, ascending: true });
        const draws = rows.map(rowToDraw);
        return json(
          { ok: true, exportedAt: new Date().toISOString(), count: draws.length, draws },
          200,
          { 'content-disposition': 'attachment; filename="nla-5-90-backup.json"' }
        );
      }

      /* --------------------------- refresh ---------------------------- */
      if (path === '/api/refresh' && method === 'POST') {
        const auth = authorised(request, env);
        if (!auth.ok) return errorJson(auth.reason ?? 'Unauthorised', 401);

        let body: { url?: string; game?: string; dryRun?: boolean } = {};
        const text = await request.text();
        if (text.trim()) {
          try {
            body = JSON.parse(text) as typeof body;
          } catch {
            /* body is optional */
          }
        }
        const outcome = await runRefresh(env, {
          url: body.url ?? url.searchParams.get('url'),
          game: body.game ?? url.searchParams.get('game'),
          dryRun: body.dryRun ?? boolParam(url, 'dryRun', false),
        });
        return json(outcome.body, outcome.status);
      }

      /* ------------------------ manual insert ------------------------- */
      if (path === '/api/draws' && method === 'POST') {
        const auth = authorised(request, env);
        if (!auth.ok) return errorJson(auth.reason ?? 'Unauthorised', 401);
        return handleImport(request, env);
      }

      /* ---------------------------- delete ---------------------------- */
      if (path === '/api/draws' && method === 'DELETE') {
        const auth = authorised(request, env);
        if (!auth.ok) return errorJson(auth.reason ?? 'Unauthorised', 401);
        const date = url.searchParams.get('date') ?? '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorJson('Query parameter ?date=YYYY-MM-DD is required.');
        const deleted = await deleteDrawByDate(env.DB, date);
        return json({ ok: true, deleted, date });
      }

      /* --------------------------- dev seed --------------------------- */
      if (path === '/api/seed' && method === 'POST') {
        const auth = authorised(request, env);
        if (!auth.ok) return errorJson(auth.reason ?? 'Unauthorised', 401);
        const draws: Draw[] = (
          seedData as Array<{ draw_date: string; game_name: string; winning: number[]; machine: number[] }>
        ).map((d) => ({
          draw_date: d.draw_date,
          game_name: d.game_name,
          winning: d.winning,
          machine: d.machine,
        }));
        const result = await insertDraws(env.DB, draws, 'seed');
        return json({ ok: true, ...result });
      }

      return errorJson(`Unknown endpoint: ${method} ${path}`, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(
        {
          ok: false,
          error: message,
          hint: /no such table/i.test(message)
            ? 'D1 schema missing. Run: npx wrangler d1 execute nla-lotto --remote --file=./schema.sql'
            : /D1|database/i.test(message)
              ? 'Check the DB binding in wrangler.toml and that the database exists.'
              : undefined,
        },
        500
      );
    }
  },

  /** Cron Trigger: 0 21 * * * — pull the latest results into D1. */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          await ensureSchema(env.DB);
          const outcome = await runRefresh(env, { source: 'cron' });
          console.log(
            `[cron ${controller.cron}] ${new Date().toISOString()} ok=${outcome.ok} ` +
              JSON.stringify(outcome.body).slice(0, 600)
          );
        } catch (err) {
          console.error('[cron] refresh failed:', err instanceof Error ? err.message : String(err));
        }
      })()
    );
  },
} satisfies ExportedHandler<Env>;

/* Re-exported so tests and the static build can reuse the exact same code. */
export { drawToRow, deduce, runBacktest, parsePayload, fetchAndParse, validateDraw };
