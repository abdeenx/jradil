/**
 * The bucket's visual state machine.
 *
 * Kept as a pure function, separate from the SVG, so the mapping from a guess's
 * result to a bucket's appearance can be tested without a DOM.
 *
 * The reveal is a two-beat animation: every bucket fills with water first, then
 * settles into the graphic for its result.
 *
 * - `correct` — the water stays, filled to the brim, and turns blue.
 * - `present` — the water stays, filled to the brim, and turns dark grey.
 * - `absent`  — the water seeps back down to a shallow residue, in a lighter
 *               grey, and the bucket itself turns grey to match.
 *
 * Every state fills with plain water first, so the colour of a bucket is never a
 * clue until the guess has actually been read.
 */

export type BucketResult = "correct" | "present" | "absent";

/** The colour the water settles into. */
export type BucketWater = "plain" | "present" | "correct" | "gray";

/**
 * The colour the letter settles into, so it stays legible in whatever it ends up
 * sitting in: ordinary ink on the page or a light grey bucket, the theme's far
 * end for a letter sunk in the darker grey pool, and the matching content colour
 * for blue water.
 */
export type BucketInk = "base" | "onGray" | "info";

export type BucketAppearance = {
  /**
   * Where the water surface comes to rest, in SVG user units: 0 is full,
   * `BUCKET_RESIDUE` is the shallow pool left by a wrong letter, and
   * `BUCKET_EMPTY` is nothing at all.
   */
  waterOffset: number;
  /** Which reveal animation to play, if any. */
  animateWater: "fill" | "drain" | null;
  /** What colour the water ends up. */
  water: BucketWater;
  /** Whether to play the colour change rather than paint it immediately. */
  animateWaterTone: boolean;
  /** What colour the letter ends up. */
  ink: BucketInk;
  animateInk: boolean;
  /** Whether the bucket itself wears the grey "not in the word" graphic. */
  gray: boolean;
  /** Whether to play the greying rather than paint it immediately. */
  animateGray: boolean;
};

/**
 * How far the water group slides down to sit fully below the bucket interior.
 *
 * Exposed to CSS as `--bucket-empty`, so the keyframes and this constant cannot
 * drift apart.
 */
export const BUCKET_EMPTY = 48;

/**
 * How far the water settles for a letter that is not in the word.
 *
 * A wrong letter is not dry: the water is still in the bucket, it has just
 * drained back to a shallow pool at the bottom. Kept well clear of both
 * `BUCKET_EMPTY` and a full bucket so the three levels read apart at a glance.
 */
export const BUCKET_RESIDUE = 26;

/**
 * How long the fill takes, in milliseconds, and how long after the fill starts
 * the settle begins. Shared with the CSS animations so the board and the styles
 * cannot drift apart.
 */
export const BUCKET_FILL_MS = 480;
export const BUCKET_SETTLE_AT_MS = 560;
/** Total length of the drain animation, which encodes fill, hold, then seep. */
export const BUCKET_DRAIN_MS = 1200;
/** Per-column stagger, so a row fills left to right rather than all at once. */
export const BUCKET_STAGGER_MS = 70;

export function bucketAppearance(
  result: BucketResult | undefined,
  animate: boolean,
): BucketAppearance {
  const gray = result === "absent";

  // Nothing typed yet leaves the bucket dry; a wrong letter leaves a residue.
  const waterOffset = result === undefined ? BUCKET_EMPTY : gray ? BUCKET_RESIDUE : 0;

  const water: BucketWater =
    result === "correct" ? "correct" : result === "present" ? "present" : gray ? "gray" : "plain";
  const ink: BucketInk = result === "correct" ? "info" : result === "present" ? "onGray" : "base";

  // Only a resolved bucket animates. A row restored from a previous session
  // renders straight into its settled graphic.
  const reveal = animate && result !== undefined;

  return {
    waterOffset,
    animateWater: reveal ? (gray ? "drain" : "fill") : null,
    water,
    // Plain water is what pours in, so there is nothing to animate from it.
    animateWaterTone: reveal && water !== "plain",
    ink,
    animateInk: reveal && ink !== "base",
    gray,
    animateGray: reveal && gray,
  };
}
