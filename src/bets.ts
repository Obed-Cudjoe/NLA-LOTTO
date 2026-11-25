/**
 * NLA 5/90 bet types, with exact probabilities and honest expected value.
 *
 * The published multipliers are fixed odds, so the EV of every bet type is a
 * one-line calculation. That makes this module the most useful thing in the
 * app: it tells the player which ticket loses the least money, and by how much.
 *
 * Probabilities are exact combinatorial results — no simulation, no estimate.
 *
 *   Direct 1  first number drawn only ......... 1/90
 *   Direct 2  both of your numbers drawn ..... C(5,2)/C(90,2) = 10/4005
 *   Direct 3  three of yours drawn ........... C(5,3)/C(90,3) = 10/117480
 *   Direct 4  four of yours drawn ............ C(5,4)/C(90,4)
 *   Direct 5  all five of yours drawn ........ 1/43949268
 */

import { BALLS, WINNING_COUNT } from './mathEngine';

/** Published NLA 5/90 multipliers (payout per unit staked). */
export const NLA_MULTIPLIERS = {
  direct1: 40,
  direct2: 240,
  direct3: 2100,
  direct4: 6000,
  direct5: 44000,
} as const;

export type BetId = keyof typeof NLA_MULTIPLIERS;

/**
 * The prices the player is *actually* paid, when they differ from the published
 * table. Kiosks and operators do diverge — a "2 sure" that returns 200× on a
 * 10 cedi debit is 17% worse than the published 240× — and an EV table built on
 * the wrong price is worse than no table at all. Defaults are the published
 * multipliers; anything set here wins.
 */
let PRICE_OVERRIDES: Partial<Record<BetId, number>> = {};

export function setPriceOverrides(overrides: Partial<Record<BetId, number>> = {}): void {
  const clean: Partial<Record<BetId, number>> = {};
  for (const [id, value] of Object.entries(overrides)) {
    const key = id as BetId;
    if (!(key in NLA_MULTIPLIERS)) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) clean[key] = value;
  }
  PRICE_OVERRIDES = clean;
}

export function priceOverrides(): Partial<Record<BetId, number>> {
  return { ...PRICE_OVERRIDES };
}

/** The multiplier in force for a bet: the player's price if given, else published. */
export function effectiveMultiplier(id: BetId): number {
  return PRICE_OVERRIDES[id] ?? NLA_MULTIPLIERS[id];
}

export interface BetType {
  id: BetId;
  label: string;
  short: string;
  /** How many numbers the player selects on one line. */
  picks: number;
  /** Exact probability the ticket wins. */
  probability: number;
  /** "1 in N" for humans. */
  oneIn: number;
  multiplier: number;
  /** Expected return per 1.00 staked. Below 1.00 means the house keeps the rest. */
  ev: number;
  /** Fraction of the stake the house keeps on average. */
  houseEdge: number;
  note: string;
}

/** Exact C(n, k), running product to avoid factorial overflow. */
function nCr(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let out = 1;
  for (let i = 0; i < kk; i++) out = (out * (n - i)) / (i + 1);
  return Math.round(out);
}

/** Probability that exactly `matched` of your `picks` numbers are among the five drawn. */
export function probabilityOfMatch(picks: number, matched: number): number {
  if (matched > picks || matched > WINNING_COUNT) return 0;
  return (nCr(WINNING_COUNT, matched) * nCr(BALLS - WINNING_COUNT, picks - matched)) / nCr(BALLS, picks);
}

/**
 * Probability that a Direct N ticket wins.
 *
 * Direct 1 is special: it pays on the FIRST ball drawn, so its chance is 1/90,
 * not the 5/90 you would get from "one of my numbers appears among the five".
 * That distinction is the whole reason the published 40x multiplier is not a
 * gift: 40 x 5/90 would return 2.2 per unit, which no operator could sustain.
 */
export function directProbability(picks: number): number {
  if (picks === 1) return 1 / BALLS;
  return probabilityOfMatch(picks, picks);
}

/** Expected return per 1.00 staked for a fixed-odds ticket. */
export function expectedReturn(probability: number, multiplier: number): number {
  return probability * multiplier;
}

const NOTES: Record<BetId, string> = {
  direct1:
    'Wins only if your number is the FIRST ball drawn — a single slot out of 90, not one of the five. Cheapest ticket, highest return per cedi.',
  direct2: 'Both of your numbers must be among the five drawn. The least-bad bet on the board.',
  direct3: 'Three of yours among the five. The payout is large because the chance is tiny.',
  direct4: 'Four of yours among the five. Rare enough that you may play a lifetime without one.',
  direct5: 'All five. About 1 in 43.9 million — five-number coverage buys more lines, not better odds.',
};

/** All five Direct bet types, sorted best-EV first. */
export function betTypes(): BetType[] {
  return (Object.keys(NLA_MULTIPLIERS) as BetId[])
    .map((id) => {
      const picks = Number(id.replace('direct', ''));
      const probability = directProbability(picks);
      const multiplier = effectiveMultiplier(id);
      const ev = expectedReturn(probability, multiplier);
      return {
        id,
        label: `Direct ${picks}`,
        short: `D${picks}`,
        picks,
        probability,
        oneIn: 1 / probability,
        multiplier,
        ev,
        houseEdge: 1 - ev,
        note: NOTES[id],
      };
    })
    .sort((a, b) => b.ev - a.ev);
}

/** The bet with the smallest expected loss. */
export function bestBet(): BetType {
  return betTypes()[0];
}

/**
 * What a coverage strategy really costs and buys.
 *
 * `lines` mutually exclusive / overlapping tickets each with probability p:
 * the chance of at least one win rises with lines, but never fast enough to
 * make the expected return positive — coverage multiplies stake and variance,
 * not edge.
 */
export function coverage({
  betId,
  lines,
  stakePerLine = 1,
}: {
  betId: BetId;
  lines: number;
  stakePerLine?: number;
}): {
  lines: number;
  totalStake: number;
  pAnyWin: number;
  expectedReturnValue: number;
  netPerPlay: number;
  evPerCedi: number;
} {
  const bet = betTypes().find((b) => b.id === betId) ?? bestBet();
  const n = Math.max(0, Math.floor(lines));
  // Independent approximation: lines are drawn without replacement from 90, so
  // this is slightly conservative for small `lines`, never optimistic.
  const pAnyWin = 1 - Math.pow(1 - bet.probability, n);
  const totalStake = n * stakePerLine;
  const expectedReturnValue = totalStake * bet.ev;
  return {
    lines: n,
    totalStake,
    pAnyWin,
    expectedReturnValue,
    netPerPlay: expectedReturnValue - totalStake,
    evPerCedi: bet.ev,
  };
}

/** Lines needed for a given chance of at least one win, and what that costs. */
export function linesForConfidence(betId: BetId, confidence: number): number {
  const bet = betTypes().find((b) => b.id === betId) ?? bestBet();
  const c = Math.min(0.999999, Math.max(0.000001, confidence));
  return Math.ceil(Math.log(1 - c) / Math.log(1 - bet.probability));
}

/**
 * The invoice for certainty: what it costs to *guarantee* a win on a ticket.
 *
 * Every "can we raise the chance to 100%" question ends here. For Direct 1 the
 * answer is exact and cheap to state: 90 lines, one per possible first ball,
 * exactly one of which wins — 90 staked for 40 back, a certain loss of 50.
 *
 * For the multi-number tickets a guarantee needs a covering design: a set of
 * lines such that every one of the C(90,5) possible draws contains at least one
 * of them. Counting gives a hard floor — one line of k numbers sits inside
 * C(90-k, 5-k) of those draws — so `lines` is a lower bound whenever `exact` is
 * false, and the true figure is at least that.
 */
export function guarantee(betId: BetId): {
  lines: number;
  exact: boolean;
  payout: number;
  /** Best case for a perfect design: one winning line, every non-winning line lost. */
  net: number;
  note: string;
} {
  const bet = betTypes().find((b) => b.id === betId) ?? bestBet();
  const exact = bet.picks === 1 || bet.picks === BALLS - WINNING_COUNT + 1 || bet.picks === 5;
  const lines = bet.picks === 1 ? BALLS : Math.ceil(1 / bet.probability);
  const payout = bet.multiplier;
  return {
    lines,
    exact,
    payout,
    net: payout - lines,
    note:
      bet.picks === 1
        ? 'One line covers one possible first ball, so 90 lines cover all of them — exactly one wins.'
        : bet.picks === 5
          ? 'Every combination of five must be bought, because each one is a separate way to win.'
          : 'A covering design: enough lines that no draw of five can avoid all of them.',
  };
}

/**
 * What it takes to hold a *named* chance of winning — the honest version of
 * "give me numbers with a 75% chance".
 *
 * Probability of at least one win across `n` lines is 1 − (1 − p)^n, which for
 * Direct 1 is exact rather than approximate: its lines are mutually exclusive
 * (one line per possible first ball), so 68 distinct numbers give exactly
 * 68/90 = 75.56%. For the multi-number tickets the same formula assumes the
 * lines are laid out disjointly, so treat the figure as a floor for messy
 * overlaps and exact for a clean design.
 *
 * The chance is real and the price is real. Which numbers you fill in does not
 * move either one: for Direct 1 *any* 68 distinct numbers give 75.56%.
 */
export interface TargetPlan {
  id: BetId;
  label: string;
  multiplier: number;
  /** Lines needed to reach the target chance. */
  lines: number;
  /** For Direct 1 these are distinct numbers and the chance is exact. */
  distinct: boolean;
  chance: number;
  stake: number;
  expectedBack: number;
  net: number;
}

export function planForChance(confidence: number): TargetPlan[] {
  const c = Math.min(0.999999, Math.max(0.000001, confidence));
  return betTypes()
    .map((bet) => {
      const distinct = bet.picks === 1;
      const lines = distinct
        ? Math.ceil(c * BALLS)
        : Math.ceil(Math.log(1 - c) / Math.log(1 - bet.probability));
      const chance = distinct ? Math.min(1, lines / BALLS) : 1 - Math.pow(1 - bet.probability, lines);
      const expectedBack = lines * bet.ev;
      return {
        id: bet.id,
        label: bet.label,
        multiplier: bet.multiplier,
        lines,
        distinct,
        chance,
        stake: lines,
        expectedBack,
        net: expectedBack - lines,
      };
    })
    .sort((a, b) => a.lines - b.lines);
}
