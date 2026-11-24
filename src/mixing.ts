/**
 * Draw mechanics: what mixing time can and cannot do to a 5/90 draw.
 *
 * The question this answers: "the drum shakes for a while and the host presses
 * a button to release each ball — can those timings predict anything?"
 *
 * The physics, in one paragraph. An air-mix drum is a chaotic mixer: tiny
 * differences in initial conditions amplify exponentially, so after a second or
 * two the position of each ball is effectively independent of where it started.
 * Bias is possible only while the drum is UNDER-mixed — when a ball still has a
 * measurable tendency to stay near its loading position. Two conditions must
 * then both hold to exploit it:
 *
 *   1. the drum is under-mixed at release, and
 *   2. you know which ball was loaded where.
 *
 * Condition 2 is the fatal one for a player: NLA loads the ball set inside a
 * sealed chamber, and the app cannot observe the loading order. Without it, a
 * bias in *position* carries no information about *identity*: the ball in slot
 * one is, from your side of the glass, a uniformly random number.
 *
 * The model below is deliberately simple and conservative, so it OVER-states
 * any edge rather than under-stating it. Even so, at any plausible mixing time
 * the best possible Direct-1 ticket is a heavy loser — which is the honest
 * answer to the timing hypothesis, and it is quantified rather than asserted.
 */

/** Balls in the NLA 5/90 drum. */
const N = 90;

export interface MixingInput {
  /** Seconds the drum is shaken before the first release (host procedure). */
  shakeSeconds: number;
  /**
   * Seconds the invited guest takes to walk from their seat to the button.
   * Time on the clock — the only question is whether the drum is running.
   */
  walkSeconds: number;
  /**
   * Whether the drum keeps mixing while the guest walks. If it runs, the walk
   * is free extra mixing; if it is stopped, identical balls settle under
   * gravity symmetrically and nothing new becomes observable either way.
   */
  drumRunsDuringWalk: boolean;
  /** Ball-to-ball collisions per second while the drum runs (order of magnitude). */
  collisionsPerSecond: number;
  /** Seconds between releases — the drum normally keeps running. */
  interReleaseSeconds: number;
  /**
   * Mixing time constant, in seconds: after `tau` seconds a ball has ~63%
   * chance of having been displaced from its loading slot. Illustrative; a
   * certified air-mix drum is far faster than the defaults used here.
   */
  tau: number;
  /** Whether the observer knows which ball was loaded into the exit slot. */
  loadingKnown: boolean;
}

export const DEFAULT_MIXING: MixingInput = {
  // NLA hosts shake well beyond this; the default is a deliberately harsh test.
  shakeSeconds: 5,
  // A guest walking from the audience to the button: seconds, not minutes.
  walkSeconds: 12,
  drumRunsDuringWalk: true,
  collisionsPerSecond: 10,
  interReleaseSeconds: 8,
  tau: 0.7,
  loadingKnown: true,
};

/**
 * Total mixing time before the first ball is released. If the drum runs while
 * the guest walks — which witnesses can see on the feed — that walk is added
 * mixing, never a source of information about *which* ball is where.
 */
export function effectiveMixSeconds(input: Partial<MixingInput> = {}): number {
  const cfg = { ...DEFAULT_MIXING, ...input };
  return cfg.shakeSeconds + (cfg.drumRunsDuringWalk ? Math.max(0, cfg.walkSeconds) : 0);
}

/** Ball-to-ball collisions each ball experiences while the drum runs. */
export function collisionsDuringWalk(input: Partial<MixingInput> = {}): number {
  const cfg = { ...DEFAULT_MIXING, ...input };
  return cfg.drumRunsDuringWalk ? Math.max(0, cfg.walkSeconds) * cfg.collisionsPerSecond : 0;
}

/** Collisions needed to reach full mixing at the given time constant. */
export function collisionsToMix(input: Partial<MixingInput> = {}): number {
  const cfg = { ...DEFAULT_MIXING, ...input };
  return cfg.tau * cfg.collisionsPerSecond;
}

/** Probability that a ball has been displaced from its loading slot. */
export function mixQuality(seconds: number, tau: number): number {
  if (!(tau > 0)) return 1;
  if (!(seconds > 0)) return 0;
  return 1 - Math.exp(-seconds / tau);
}

/**
 * Probability that a given ball is the FIRST ball released, for the most
 * favoured ball (the one loaded in the exit slot), versus an ordinary ball.
 *
 * With no knowledge of the loading order every ball is 1/90 regardless of
 * mixing — the numbers are exchangeable from the observer's side.
 */
export function firstBallProbability(input: Partial<MixingInput> = {}): {
  favoured: number;
  ordinary: number;
  uniform: number;
  quality: number;
} {
  const cfg = { ...DEFAULT_MIXING, ...input };
  const { tau, loadingKnown } = cfg;
  const q = mixQuality(effectiveMixSeconds(cfg), tau);
  const uniform = 1 / N;
  if (!loadingKnown) return { favoured: uniform, ordinary: uniform, uniform, quality: q };
  // The exit slot keeps its ball with probability 1-q; otherwise any ball can
  // arrive there uniformly. This is the most generous possible assumption.
  return {
    favoured: q * uniform + (1 - q),
    ordinary: q * uniform,
    uniform,
    quality: q,
  };
}

/**
 * Best possible expected return per 1.00 staked on Direct 1, assuming perfect
 * knowledge of the favoured ball. Compare with the published 40x multiplier:
 * uniform chance returns 40/90 = 0.444.
 */
export function bestDirect1Ev(input: Partial<MixingInput> = {}): number {
  return firstBallProbability(input).favoured * 40;
}

/**
 * How long the drum would have to be shaken (seconds) for Direct 1 to stop
 * being a losing bet, under the favourable-ball assumption. Below this the
 * market would be beatable — but only with a known loading order.
 */
export function breakEvenShakeSeconds(tau = DEFAULT_MIXING.tau, multiplier = 40): number {
  const target = 1 / multiplier; // required probability for EV = 1
  // q/N + (1 - q) = target  ->  q = (1 - target) / (1 - 1/N)
  const q = (1 - target) / (1 - 1 / N);
  if (q <= 0) return 0;
  if (q >= 1) return Number.POSITIVE_INFINITY;
  return -tau * Math.log(1 - q);
}

/** Mixing quality achieved for each of the five releases. */
export function qualityPerRelease(input: Partial<MixingInput> = {}): number[] {
  const cfg = { ...DEFAULT_MIXING, ...input };
  const { interReleaseSeconds, tau } = cfg;
  const first = effectiveMixSeconds(cfg);
  return Array.from({ length: 5 }, (_, k) =>
    mixQuality(first + k * Math.max(0, interReleaseSeconds), tau)
  );
}

/**
 * Residual positional bias per release: how far the favoured ball's chance of
 * occupying that release slot is above uniform. Decays geometrically because
 * the drum keeps mixing between releases — which is why, if any bias existed,
 * it would be largest on the FIRST ball. That is also the prediction to look
 * for in the archive (see drawOrder.ts).
 */
export function positionalBiasPerRelease(input: Partial<MixingInput> = {}): number[] {
  const q = qualityPerRelease(input);
  return q.map((qi) => qi / N + (1 - qi) - 1 / N);
}

/**
 * Draws needed to detect a single ball whose true probability of being drawn
 * first is `p` instead of 1/90, using a two-sided binomial test at `alpha`
 * with `power`. Shown in the UI so the player can see how much data the
 * question actually requires — usually far more than exists.
 */
export function drawsToDetect(p: number, alpha = 0.05, power = 0.8): number {
  const p0 = 1 / N;
  const zA = alpha === 0.05 ? 1.959964 : 2.575829; // two-sided
  const zB = power >= 0.8 ? 0.841621 : 0.524401;
  const delta = Math.abs(p - p0);
  if (delta < 1e-12) return Number.POSITIVE_INFINITY;
  const num = zA * Math.sqrt(p0 * (1 - p0)) + zB * Math.sqrt(p * (1 - p));
  return Math.ceil((num * num) / (delta * delta));
}

/** Plain-English verdict for the current inputs. */
export function mixingVerdict(input: Partial<MixingInput> = {}): string {
  const cfg = { ...DEFAULT_MIXING, ...input };
  const { quality, favoured } = firstBallProbability(cfg);
  const ev = favoured * 40;
  const breakEven = breakEvenShakeSeconds(cfg.tau);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  if (!cfg.loadingKnown) {
    return `Without knowing the loading order every ball is exactly 1 in 90 whatever the timing, so Direct 1 returns ${pct(40 / 90)} of stake. The shake time changes nothing you can observe.`;
  }
  if (ev >= 1) {
    return `At ${cfg.shakeSeconds}s of shaking${cfg.drumRunsDuringWalk ? ` plus a ${cfg.walkSeconds}s walk` : ''} the drum is still under-mixed (${pct(quality)} displaced): a known favoured ball would win Direct 1 ${pct(favoured)} of the time and return ${ev.toFixed(2)} per 1.00 staked. Break-even starts at about ${breakEven.toFixed(1)}s — but this requires a loading order you cannot see.`;
  }
  return `With ${cfg.shakeSeconds}s of shaking${cfg.drumRunsDuringWalk ? ` and ${cfg.walkSeconds}s of the guest walking` : ''} the drum is ${pct(quality)} mixed, leaving the favoured ball at ${pct(favoured)} — Direct 1 would still return only ${ev.toFixed(2)} per 1.00. It needs under ${breakEven.toFixed(1)}s of shaking to become beatable, and even then only with a known loading order.`;
}
