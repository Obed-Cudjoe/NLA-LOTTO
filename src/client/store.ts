/** localStorage persistence + static-mode GitHub bridge. Browser only. */
import { DEFAULT_CONFIG, normalizeHistory, type Draw, type EngineConfig } from '../mathEngine';
import type { TimingEntry } from '../timingJournal';
import type { PickRecord } from '../pickBook';
import type { MixingInput } from '../mixing';
import type { AppState, Settings } from './types';

const PREFIX = 'nla590:';
const KEYS = {
  settings: `${PREFIX}settings`,
  config: `${PREFIX}config`,
  overlay: `${PREFIX}overlay`,
  ui: `${PREFIX}ui`,
  journal: `${PREFIX}journal`,
  pickBook: `${PREFIX}pickBook`,
} as const;

export const DEFAULT_SETTINGS: Settings = {
  adminKey: '',
  sourceUrl: 'https://www.24lottos.com/lottery/ghana-lotto/results',
  ghToken: '',
  ghRepo: '',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — fail silently, app still works in-memory */
  }
}

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) });
export const saveSettings = (s: Settings): void => write(KEYS.settings, s);

export function loadConfig(): EngineConfig {
  const stored = read<Partial<EngineConfig>>(KEYS.config, {});
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    weights: { ...DEFAULT_CONFIG.weights, ...(stored.weights ?? {}) },
    filters: { ...DEFAULT_CONFIG.filters, ...(stored.filters ?? {}) },
  };
}
export const saveConfig = (c: EngineConfig): void => write(KEYS.config, c);

export const loadOverlay = (): Draw[] => read<Draw[]>(KEYS.overlay, []);
export const saveOverlay = (d: Draw[]): void => write(KEYS.overlay, normalizeHistory(d));

export interface UiPrefs {
  view: AppState['view'];
  game: string;
  advanced: boolean;
  minTrain: number;
  simulations: number;
  /** Drum-timing simulator inputs (see src/mixing.ts). */
  lab?: Partial<MixingInput>;
}
export const loadJournal = (): TimingEntry[] => read<TimingEntry[]>(KEYS.journal, []);
export const saveJournal = (entries: TimingEntry[]): void => write(KEYS.journal, entries);

/** Lines this browser has committed to, scored once the draw is known. */
export const loadPickBook = (): PickRecord[] => read<PickRecord[]>(KEYS.pickBook, []);
export const savePickBook = (book: PickRecord[]): void => write(KEYS.pickBook, book);

export const loadUi = (): Partial<UiPrefs> => read<Partial<UiPrefs>>(KEYS.ui, {});
export const saveUi = (p: Partial<UiPrefs>): void => write(KEYS.ui, { ...loadUi(), ...p });

export const wipeLocal = (): void => {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
};

/* ==========================================================================
 * File download helper
 * ========================================================================== */

export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const drawsToCsv = (draws: readonly Draw[]): string => {
  const header = 'date,game,num1,num2,num3,num4,num5,mac1,mac2,mac3,mac4,mac5';
  const rows = draws.map((d) => [d.draw_date, d.game_name, ...d.winning, ...d.machine].join(','));
  return [header, ...rows].join('\n');
};

/* ==========================================================================
 * GitHub bridge (static / GitHub-only mode)
 * ========================================================================== */

const GH = 'https://api.github.com';

export interface GhResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function ghFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<GhResult<T>> {
  try {
    const res = await fetch(`${GH}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    if (!res.ok) {
      const message =
        (data as { message?: string } | undefined)?.message ?? `GitHub API responded ${res.status}`;
      return { ok: false, status: res.status, error: message, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** UTF-8 safe base64 for the Contents API. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Commit an updated data/draws.json (merge remote + local overlay).
 * Returns a friendly status message instead of throwing.
 */
export async function commitDrawsToGitHub(
  repo: string,
  token: string,
  draws: Draw[],
  path = 'data/draws.json'
): Promise<{ ok: boolean; message: string }> {
  if (!repo || !token) return { ok: false, message: 'Add a repository and a GitHub token first.' };

  const current = await ghFetch<{ sha: string; content: string }>(
    `/repos/${repo}/contents/${path}`,
    token
  );
  let remote: Draw[] = [];
  let sha: string | undefined;

  if (current.ok && current.data) {
    sha = current.data.sha;
    try {
      remote = JSON.parse(fromBase64(current.data.content)) as Draw[];
    } catch {
      remote = [];
    }
  } else if (current.status && current.status !== 404) {
    return { ok: false, message: current.error ?? 'Could not read the existing data file.' };
  }

  const merged = normalizeHistory([...remote, ...draws]);
  const body = JSON.stringify(
    merged.map((d) => ({
      draw_date: d.draw_date,
      game_name: d.game_name,
      winning: d.winning,
      machine: d.machine,
    })),
    null,
    2
  );

  const put = await ghFetch(`/repos/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `data: sync ${draws.length} draw(s) from the deduction dashboard`,
      content: toBase64(`${body}\n`),
      ...(sha ? { sha } : {}),
    }),
  });

  if (!put.ok) return { ok: false, message: put.error ?? 'Commit failed.' };
  return {
    ok: true,
    message: `Committed ${merged.length} draws to ${repo}/${path}. The Pages workflow will rebuild automatically.`,
  };
}

/**
 * Best guess at this site's repository: the saved setting, else the GitHub
 * Pages URL itself. Used to prefill the Data tab and to build the Actions deep
 * link, so getting it wrong means every button 404s.
 *
 * A project site is `owner.github.io/<repo>` — with *or without* a trailing
 * slash, and also when a deep path is appended (`/<repo>/index.html`). Only a
 * bare `owner.github.io/` is a root user site, whose repository is named
 * `owner.github.io`. The first path segment is therefore the repo, never the
 * second.
 *
 * `href` is injectable so the rule can be tested without a browser.
 */
export function guessRepo(saved: string, href = location.href): string {
  const trimmed = saved.trim();
  if (trimmed) return trimmed;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return '';
  }
  if (!url.hostname.endsWith('.github.io')) return '';
  const owner = url.hostname.slice(0, -'.github.io'.length);
  const [first] = url.pathname.split('/').filter(Boolean);
  return first ? `${owner}/${first}` : `${owner}/${owner}.github.io`;
}

/** Deep link to a workflow's page (the "Run workflow" button lives there). */
export function workflowUrl(repo: string, workflow = 'refresh-draws.yml'): string {
  return repo ? `https://github.com/${repo}/actions/workflows/${workflow}` : 'https://github.com';
}

/** Fire the refresh-results workflow (needs actions:write on the token). */
export async function triggerRefreshWorkflow(
  repo: string,
  token: string,
  workflow = 'refresh-draws.yml',
  ref = 'main'
): Promise<{ ok: boolean; message: string }> {
  if (!repo || !token) return { ok: false, message: 'Add a repository and a GitHub token first.' };
  const res = await ghFetch(`/repos/${repo}/actions/workflows/${workflow}/dispatches`, token, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.error ??
        `Could not dispatch ${workflow}. Check the token has actions:write and the workflow exists on ${ref}.`,
    };
  }
  return { ok: true, message: `Triggered ${workflow} on ${repo}@${ref}. Results appear in a minute or two.` };
}
