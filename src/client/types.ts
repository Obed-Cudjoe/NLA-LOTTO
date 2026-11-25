import type {
  LastDrawReview, BacktestResult, Deduction, Draw, EngineConfig } from '../mathEngine';
import type { OrderReport } from '../drawOrder';
import type { MixingInput } from '../mixing';
import type { JournalReport, TimingEntry } from '../timingJournal';
import type { PickBookReport, PickRecord } from '../pickBook';

export type Mode = 'worker' | 'static';
/** A tab inside "the tool". */
export type View = 'deduce' | 'lab' | 'backtest' | 'ledger' | 'settings';
/** A page of the public site. */
export type Page = 'home' | 'tonight' | 'results' | 'games' | 'smart' | 'method' | 'tools';
export type Tone = 'ok' | 'bad' | 'info' | 'warn';

export interface Health {
  ok: boolean;
  mode?: string;
  version?: string;
  draws?: number;
  latest?: { date: string; game: string | null; label: string } | null;
  next?: { date: string; game: string; label: string } | null;
  hasAdminKey?: boolean;
  hasSourceUrl?: boolean;
  dbError?: string;
  time?: string;
}

export interface Settings {
  /** Only kept if the user chooses to store it; sent as x-api-key. */
  adminKey: string;
  /** Source URL used by the in-browser refresh/import helpers. */
  sourceUrl: string;
  /** Optional fine-grained PAT with contents:write, for GitHub-only mode. */
  ghToken: string;
  /** owner/repo, e.g. "Obed-Cudjoe/NLA-LOTTO". */
  ghRepo: string;
}

export interface AppState {
  mode: Mode;
  /** Which section of the site is showing. The tool is one of them. */
  page: Page;
  health: Health | null;
  /** Every draw the app knows about, all games, chronological. */
  draws: Draw[];
  /** Local-only additions (static mode) persisted in localStorage. */
  overlay: Draw[];
  game: string;
  config: EngineConfig;
  view: View;
  deduction: Deduction | null;
  /** What the engine said before the newest stored draw, vs what came out. */
  review: LastDrawReview | null;
  /** First-ball (order) analysis of the selected game(s) — the machine-bias test. */
  order: OrderReport | null;
  /** The same test over every stored draw, regardless of the game filter. */
  orderAll: OrderReport | null;
  /** Drum-timing simulator inputs. */
  lab: MixingInput;
  /** Timings the player logged themselves (walk seconds, first ball). */
  journal: TimingEntry[];
  /**
   * Stopwatch marks taken live from the broadcast. `performance.now()` marks
   * while running; the finished values in seconds once stopped.
   */
  stopwatch: {
    walkStart: number | null;
    walkSeconds: number | null;
    shakeStart: number | null;
    shakeSeconds: number | null;
  };
  /** Test of whether walk time predicts the first ball. */
  journalReport: JournalReport | null;
  /** Prices the player is actually paid, when they differ from the published table. */
  prices: Partial<Record<string, number>>;
  /** Lines locked before a draw, so the record can be scored honestly. */
  pickBook: PickRecord[];
  /** How those lines have actually done, versus chance. */
  pickReport: PickBookReport;
  backtest: BacktestResult | null;
  backtestOpts: { minTrain: number; simulations: number };
  settings: Settings;
  busy: string | null;
  toast: { text: string; tone: Tone } | null;
  search: string;
  ledgerLimit: number;
  advanced: boolean;
  lastSync: string | null;
  error: string | null;
}
