/**
 * ---------------------------------------------------------------------------
 * Modular results scraper / parser
 * ---------------------------------------------------------------------------
 * Deliberately dependency-free and DOM-free: Cloudflare Workers have no
 * DOMParser, so parsing is done with ordered, individually-replaceable
 * strategies. Add your own source by pushing a function into `htmlStrategies`
 * or `jsonStrategies` — nothing else in the app needs to change.
 *
 * Pipeline:
 *   fetchResults(url)  ->  parsePayload(body, contentType, opts)  ->  valid Draw[]
 *
 * Every candidate draw is run through `validateDraw()` from the math engine, so
 * a malformed source can never poison the D1 table.
 */
import { formatDrawDate, gameForDate, isIsoDate, validateDraw, type Draw } from './mathEngine';

export interface ParseOptions {
  /** Game to assume when the page does not name one. */
  defaultGame?: string;
  /** Keep rows that publish only the 5 winning numbers (machine numbers are required for storage). */
  requireMachine?: boolean;
  /** Reference date used to complete partial dates such as "Sat 21 Nov". */
  today?: string;
  /**
   * Pin each row's game to NLA's weekday schedule (Mon = Monday Special …
   * Sat = National Weekly) and reject Sundays, where no 5/90 evening game is
   * drawn. Default true: results pages are unreliable at labelling the game,
   * but a date is unambiguous. Set false for an unusual rescheduled draw.
   */
  respectSchedule?: boolean;
  /**
   * Reference instant for the "has this draw happened?" guard (ISO-8601).
   * Defaults to the host clock; injectable so tests are not clock-dependent.
   */
  now?: string;
  /**
   * Earliest GMT time at which today's result may exist. NLA's six evening
   * games close at 19:15 GMT and the last (ASEDA) at 19:50, so anything dated
   * "today" before 20:00 is a placeholder, a next-draw label or a stale block.
   */
  drawWindowCloses?: string;
}

export interface ParseResult {
  draws: Draw[];
  warnings: string[];
  errors: string[];
}

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  body: string;
  error?: string;
}

const DEFAULT_GAME = 'Monday Special';

/* ==========================================================================
 * 1. Fetch
 * ========================================================================== */

export async function fetchResults(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'GhanaNLA-5-90-Deduction-Engine/1.0 (+personal analytics; contact: you@example.com)',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-GB,en;q=0.9',
        ...(opts.headers ?? {}),
      },
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
      body,
      ...(res.ok ? {} : { error: `Source responded HTTP ${res.status}` }),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      contentType: '',
      body: '',
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* ==========================================================================
 * 2. Number / date extraction helpers
 * ========================================================================== */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Aggregators label every block with the *upcoming* draw ("NEXT DRAW Mon, Nov
 * 23, 2026"). Those are the wrong dates to attach to the numbers next to them,
 * and taking them creates draws that have not happened yet — so scrub them
 * before any date is read out of a block.
 */
function scrubNextDrawLabels(text: string): string {
  return text
    .replace(/\bnext\s*draw\b[^0-9]{0,24}\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/gi, ' ')
    .replace(/\bnext\s*draw\b[^0-9]{0,24}\d{1,2}[^0-9]{0,14}\d{2,4}/gi, ' ');
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function safeIso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const candidate = iso(y, m, d);
  return isIsoDate(candidate) ? candidate : null;
}

/** Find an ISO / numeric / month-name date anywhere in a text blob. */
export function extractDate(raw: string, today = new Date().toISOString().slice(0, 10)): string | null {
  const text = scrubNextDrawLabels(raw);
  // 2026-11-21 / 2026/11/21
  let m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const found = safeIso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (found) return found;
  }
  // 21/11/2026 or 21.11.26 (Ghana convention: day first)
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const day = a > 12 ? a : a; // day-first by default
    const month = a > 12 ? b : b;
    const found = a > 12 ? safeIso(y, month - 1, day) : safeIso(y, month - 1, day);
    if (found) return found;
    const swapped = safeIso(y, day - 1, month);
    if (swapped) return swapped;
  }
  // Saturday 21 November 2026 / Sat 21 Nov 2026 / 21 Nov
  m = text.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s*(\d{4})?\b/);
  if (m) {
    const monthKey = m[2].slice(0, 3).toLowerCase();
    const month = MONTHS[monthKey];
    if (month !== undefined) {
      const year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
      const found = safeIso(year, month, Number(m[1]));
      if (found) return found;
    }
  }
  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})\b/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const found = safeIso(Number(m[3]), month, Number(m[2]));
      if (found) return found;
    }
  }
  return null;
}

/**
 * Pull 1..90 integers out of a text blob, ignoring years, dates and markup
 * artefacts. Returns them in the order they appear.
 */
export function extractNumbers(text: string, max = 10): number[] {
  // Strip dates and clock times FIRST and as whole units, otherwise fragments
  // such as the "16" in "2026-11-16" or the "19"/"50" in "19:50" get counted
  // as drawn numbers.
  const cleaned = text
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ') // 2026-11-21
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, ' ') // 21/11/2026
    .replace(/\b\d{1,2}[-/.]\d{1,2}\b/g, ' ') // 21-11 leftovers
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s*\d{2,4}\b/gi,
      ' '
    ) // 21 November 2026
    .replace(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*\d{2,4}\b/gi,
      ' '
    ) // November 21, 2026
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ') // 19:50
    .replace(/\b(?:19|20)\d{2}\b/g, ' ') // stray years
    .replace(/[^\d\s,;|/-]/g, ' ');
  const out: number[] = [];
  for (const token of cleaned.match(/\d{1,3}/g) ?? []) {
    const n = Number(token);
    if (Number.isInteger(n) && n >= 1 && n <= 90) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

const stripTags = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

const KNOWN_GAMES = [
  'Monday Special',
  'Lucky Tuesday',
  'Midweek',
  'Mid Week',
  'Mid-Week',
  'Fortune Thursday',
  'Friday Bonanza',
  'National Weekly',
  'National Week',
  'VAG',
];

/** Lowercase + collapse every separator so "Mid - Week" == "mid week". */
const normalizeWords = (value: string): string =>
  ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

export function findGame(text: string, fallback?: string): string | null {
  const haystack = normalizeWords(text);
  for (const game of KNOWN_GAMES) {
    if (!haystack.includes(normalizeWords(game))) continue;
    if (/mid\s*week/i.test(game)) return 'Midweek';
    if (/national week/i.test(game)) return 'National Weekly';
    if (game === 'VAG') return 'Fortune Thursday';
    return game;
  }
  return fallback ?? null;
}

/* ==========================================================================
 * 3. Parser strategies
 * ========================================================================== */

export interface RawCandidate {
  draw_date?: string | null;
  game_name?: string | null;
  winning: number[];
  machine: number[];
  source?: string;
}

export type HtmlStrategy = (html: string, opts: ParseOptions) => RawCandidate[];
export type JsonStrategy = (payload: unknown, opts: ParseOptions) => RawCandidate[];

/** Turn 10 flat numbers into 5 winning + 5 machine. */
function splitTen(nums: number[]): { winning: number[]; machine: number[] } {
  if (nums.length >= 10) return { winning: nums.slice(0, 5), machine: nums.slice(5, 10) };
  return { winning: nums.slice(0, 5), machine: [] };
}

/* --- Strategy A: JSON-LD / embedded script payloads ---------------------- */
export const jsonBlobStrategy: HtmlStrategy = (html) => {
  const out: RawCandidate[] = [];
  const blocks = html.match(/<script[^>]*(?:application\/ld\+json|application\/json)[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const jsonText = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    try {
      const parsed = JSON.parse(jsonText);
      out.push(...collectJsonCandidates(parsed, {}));
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
};

/* --- Strategy B: <table> rows -------------------------------------------- */
export const tableRowStrategy: HtmlStrategy = (html, opts) => {
  const out: RawCandidate[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(stripTags);
    const text = cells.length ? cells.join(' | ') : stripTags(row);
    if (text.length < 6) continue;
    const date = extractDate(text, opts.today);
    const nums = extractNumbers(text, 10);
    if (!date || nums.length < 10) continue;
    const game = findGame(text, opts.defaultGame ?? DEFAULT_GAME) ?? DEFAULT_GAME;
    const { winning, machine } = splitTen(nums);
    out.push({ draw_date: date, game_name: game, winning, machine });
  }
  return out;
};

/* --- Strategy C: heading-delimited result blocks ------------------------- */
export const headingBlockStrategy: HtmlStrategy = (html, opts) => {
  const out: RawCandidate[] = [];
  // Break the page at headings and at result-ish containers.
  const chunks = html.split(/<h[1-4][^>]*>|<\/h[1-4]>|<section[^>]*>|<\/section>|<article[^>]*>|<\/article>/i);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk || chunk.length < 8) continue;
    const text = stripTags(chunk);
    if (text.length < 8 || text.length > 1200) continue;
    const date = extractDate(text, opts.today);
    if (!date) continue;
    const nums = extractNumbers(text, 10);
    if (nums.length < 10) continue;
    // Game may be in this chunk or the heading immediately before it.
    const context = `${stripTags(chunks[i - 1] ?? '')} ${text}`;
    const game = findGame(context, opts.defaultGame ?? DEFAULT_GAME) ?? DEFAULT_GAME;
    const { winning, machine } = splitTen(nums);
    out.push({ draw_date: date, game_name: game, winning, machine });
  }
  return out;
};

/* --- Strategy D: labelled plain text (works on pasted terminal output) --- */
export const labelledTextStrategy: HtmlStrategy = (html, opts) => {
  const out: RawCandidate[] = [];
  const blocks = stripTags(html).split(/(?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2}\s+[A-Za-z]{3,9})/);
  for (const block of blocks) {
    if (block.trim().length < 10) continue;
    const date = extractDate(block, opts.today);
    if (!date) continue;
    const nums = extractNumbers(block, 10);
    if (nums.length < 10) continue;
    const game = findGame(block, opts.defaultGame ?? DEFAULT_GAME) ?? DEFAULT_GAME;
    const { winning, machine } = splitTen(nums);
    out.push({ draw_date: date, game_name: game, winning, machine });
  }
  return out;
};

/** Ordered strategy list — add yours here. */
export const htmlStrategies: Array<{ name: string; parse: HtmlStrategy }> = [
  { name: 'json-blob', parse: jsonBlobStrategy },
  { name: 'table-row', parse: tableRowStrategy },
  { name: 'heading-block', parse: headingBlockStrategy },
  { name: 'labelled-text', parse: labelledTextStrategy },
];

/* --- JSON payload strategy ---------------------------------------------- */

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (typeof value === 'string') return value.split(/[\s,;|]+/).map(Number).filter((n) => Number.isFinite(n));
  return [];
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    const found = Object.keys(obj).find((key) => key.toLowerCase() === k.toLowerCase());
    if (found && obj[found] !== undefined && obj[found] !== null && obj[found] !== '') return obj[found];
  }
  return undefined;
}

/** Recursively find draw-like records inside an arbitrary JSON payload. */
export function collectJsonCandidates(payload: unknown, opts: ParseOptions, depth = 0): RawCandidate[] {
  if (depth > 6 || payload === null || payload === undefined) return [];
  if (Array.isArray(payload)) {
    // An array of 10 numbers is itself a draw.
    if (payload.length >= 10 && payload.every((x) => Number.isFinite(Number(x)))) {
      const nums = payload.slice(0, 10).map(Number);
      const { winning, machine } = splitTen(nums);
      return [{ draw_date: opts.today ?? null, game_name: opts.defaultGame ?? DEFAULT_GAME, winning, machine }];
    }
    return payload.flatMap((item) => collectJsonCandidates(item, opts, depth + 1));
  }
  if (typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;

  const dateRaw = pick(obj, ['draw_date', 'date', 'drawDate', 'draw', 'drawday', 'day']);
  const gameRaw = pick(obj, ['game_name', 'game', 'gameName', 'name', 'title', 'lottery']);
  const winningRaw = pick(obj, ['winning', 'winning_numbers', 'winningNumbers', 'numbers', 'winners', 'results', 'win', 'balls']);
  const machineRaw = pick(obj, ['machine', 'machine_numbers', 'machineNumbers', 'mac', 'bonus', 'extra']);

  let winning = toNumberArray(winningRaw);
  let machine = toNumberArray(machineRaw);

  // Flat num1..num5 / mac1..mac5 form.
  if (!winning.length || !machine.length) {
    const flatWin = ['num1', 'num2', 'num3', 'num4', 'num5'].map((k) => pick(obj, [k]));
    const flatMac = ['mac1', 'mac2', 'mac3', 'mac4', 'mac5'].map((k) => pick(obj, [k]));
    if (flatWin.every((v) => v !== undefined)) winning = flatWin.map(Number);
    if (flatMac.every((v) => v !== undefined)) machine = flatMac.map(Number);
  }

  // A single "ten numbers" array.
  if (winning.length >= 10 && !machine.length) {
    const split = splitTen(winning);
    winning = split.winning;
    machine = split.machine;
  }

  const candidates: RawCandidate[] = [];
  if (winning.length >= 5) {
    const date = typeof dateRaw === 'string' ? extractDate(dateRaw, opts.today) : (opts.today ?? null);
    candidates.push({
      draw_date: date,
      game_name: typeof gameRaw === 'string' ? findGame(gameRaw, gameRaw) ?? gameRaw : (opts.defaultGame ?? DEFAULT_GAME),
      winning,
      machine,
    });
  }

  // Keep walking nested containers.
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      candidates.push(...collectJsonCandidates(value, opts, depth + 1));
    }
  }
  return candidates;
}

export const jsonStrategies: Array<{ name: string; parse: JsonStrategy }> = [
  { name: 'recursive-json', parse: (payload, opts) => collectJsonCandidates(payload, opts) },
];

/* ==========================================================================
 * 4. Orchestration: payload -> validated draws
 * ========================================================================== */

/** Turn raw candidates into validated, de-duplicated draws. */
export function validateCandidates(candidates: RawCandidate[], opts: ParseOptions = {}): ParseResult {
  const draws: Draw[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  /** draw_date -> signature of the ten numbers, so overlapping strategies can agree. */
  const seen = new Map<string, string>();

  const nowIso = opts.now ?? new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);
  const nowTime = nowIso.slice(11, 16);
  const windowClose = opts.drawWindowCloses ?? '20:00';

  for (const [i, c] of candidates.entries()) {
    if (!c.winning.length) continue;
    if (c.machine.length < 5) {
      warnings.push(
        `candidate ${i + 1} (${c.draw_date ?? 'no date'}) published ${c.winning.length} winning numbers but no machine numbers — skipped (5 winning + 5 machine are required)`
      );
      continue;
    }
    const result = validateDraw({
      draw_date: c.draw_date ?? '',
      game_name: c.game_name ?? opts.defaultGame ?? DEFAULT_GAME,
      winning: c.winning,
      machine: c.machine,
    });
    if (!result.ok || !result.draw) {
      errors.push(`candidate ${i + 1}: ${result.errors.join('; ')}`);
      continue;
    }
    // A draw cannot be dated after today, and today's evening result cannot
    // exist before the draw windows close. Both patterns come from aggregator
    // pages that print "NEXT DRAW <date>" next to yesterday's numbers.
    if (result.draw.draw_date > todayIso) {
      warnings.push(
        `${result.draw.draw_date} is in the future (today is ${todayIso}) — that is a scheduled draw, not a result; row skipped`
      );
      continue;
    }
    if (result.draw.draw_date === todayIso && nowTime < windowClose) {
      warnings.push(
        `${result.draw.draw_date} is dated today, but at ${nowTime} GMT the evening draw has not closed yet (results appear after ${windowClose}) — row skipped`
      );
      continue;
    }

    // Trust the calendar over the page. Aggregators routinely label every row
    // with whichever game name appears first in their markup, and some list
    // Sunday/ASEDA draws alongside the six 5/90 evening games.
    let gameName = result.draw.game_name;
    if (opts.respectSchedule !== false) {
      const scheduled = gameForDate(result.draw.draw_date);
      if (!scheduled) {
        warnings.push(
          `${result.draw.draw_date} is a Sunday — no NLA 5/90 evening game is drawn that day; row skipped`
        );
        continue;
      }
      if (gameName !== scheduled) {
        warnings.push(
          `${result.draw.draw_date}: source said "${gameName}", weekday schedule says "${scheduled}" — stored as "${scheduled}"`
        );
        gameName = scheduled;
      }
    }
    const draw: Draw = { ...result.draw, game_name: gameName };

    const signature = [...draw.winning, ...draw.machine].join(',');
    const previous = seen.get(draw.draw_date);
    if (previous !== undefined) {
      // Two strategies often find the same row — that is agreement, not a
      // conflict, so stay quiet unless the numbers actually disagree.
      if (previous !== signature) {
        warnings.push(
          `conflicting rows for ${draw.draw_date} in source (${previous} vs ${signature}) — kept the first`
        );
      }
      continue;
    }
    seen.set(draw.draw_date, signature);
    draws.push(draw);
  }

  draws.sort((a, b) => b.draw_date.localeCompare(a.draw_date)); // newest first
  return { draws, warnings, errors };
}

/** Parse an arbitrary response body (JSON or HTML) into validated draws. */
export function parsePayload(
  body: string,
  contentType = '',
  opts: ParseOptions = {}
): ParseResult & { strategies: string[] } {
  const trimmed = body.trim();
  const looksJson =
    /json/i.test(contentType) || trimmed.startsWith('{') || trimmed.startsWith('[');

  const usedStrategies: string[] = [];

  if (looksJson) {
    try {
      const payload = JSON.parse(trimmed);
      for (const strategy of jsonStrategies) {
        const candidates = strategy.parse(payload, opts);
        if (candidates.length) {
          usedStrategies.push(strategy.name);
          const parsed = validateCandidates(candidates, opts);
          if (parsed.draws.length) return { ...parsed, strategies: usedStrategies };
          return {
            draws: [],
            warnings: parsed.warnings,
            errors: parsed.errors.length ? parsed.errors : ['JSON parsed but no valid 10-number draw found'],
            strategies: usedStrategies,
          };
        }
      }
    } catch (err) {
      // Fall through to HTML strategies — some sources mislabel JSON.
      void err;
    }
  }

  const allCandidates: RawCandidate[] = [];
  for (const strategy of htmlStrategies) {
    try {
      const candidates = strategy.parse(body, opts);
      if (candidates.length) {
        usedStrategies.push(strategy.name);
        allCandidates.push(...candidates);
      }
    } catch {
      /* a strategy must never break ingestion */
    }
  }

  if (!allCandidates.length) {
    return {
      draws: [],
      warnings: [],
      errors: [
        'No draw rows recognised. The source layout probably changed. ' +
          'Paste the results into the Historical Ledger import box, or add a strategy in src/scraper.ts.',
      ],
      strategies: usedStrategies,
    };
  }

  const parsed = validateCandidates(allCandidates, opts);
  return { ...parsed, strategies: usedStrategies };
}

/** Fetch + parse in one call (used by the cron trigger and /api/refresh). */
export async function fetchAndParse(
  url: string,
  opts: ParseOptions & { timeoutMs?: number } = {}
): Promise<ParseResult & { fetch: { status: number; url: string; contentType: string }; strategies: string[] }> {
  const res = await fetchResults(url, { timeoutMs: opts.timeoutMs });
  if (!res.ok) {
    return {
      draws: [],
      warnings: [],
      errors: [res.error ?? `Fetch failed (HTTP ${res.status})`],
      strategies: [],
      fetch: { status: res.status, url: res.url, contentType: res.contentType },
    };
  }
  const parsed = parsePayload(res.body, res.contentType, opts);
  return {
    ...parsed,
    fetch: { status: res.status, url: res.url, contentType: res.contentType },
  };
}

/** Human-readable summary of a parsed batch (for logs / cron output). */
export function summariseParsed(result: ParseResult): string {
  const dates = result.draws.map((d) => `${d.draw_date} ${d.game_name}`).slice(0, 5);
  return [
    `${result.draws.length} valid draw(s)`,
    dates.length ? `newest: ${dates[0]}` : 'newest: —',
    result.warnings.length ? `${result.warnings.length} warning(s)` : '',
    result.errors.length ? `${result.errors.length} error(s)` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export { formatDrawDate };
