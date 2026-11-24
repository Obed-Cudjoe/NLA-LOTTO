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
      const multiplier = NLA_MULTIPLIERS[id];
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
