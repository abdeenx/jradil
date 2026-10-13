import { useId } from "react";

import {
  BUCKET_EMPTY,
  BUCKET_RESIDUE,
  bucketAppearance,
  type BucketInk,
  type BucketResult,
  type BucketWater,
} from "#/lib/bucket.ts";

/**
 * A bucket, drawn entirely as SVG paths and animated entirely with CSS. No image
 * files, no icon font, no animation library.
 *
 * The silhouette is deliberately squarish: near-constant width with only a light
 * taper, and a rim band that barely overhangs the body.
 *
 * Geometry, in a 56 × 58 viewBox offset to x=4:
 *   rim      a banded bar across the top; the water never crosses it
 *   body     near-uniform sides pulling in gently to a rounded base
 *   interior an inset copy of the body, used to clip the water so it can never
 *            spill over the rim or through the sides — only down and out through
 *            the bottom, which is what makes the drain read as seeping
 *
 * Every shape is symmetric about x=32, and the viewBox is trimmed to the drawn
 * extent so the buckets sit close together rather than floating in dead space.
 */
const BODY_PATH = "M9,12 H55 L51,50 Q50.5,55 45.5,55 H18.5 Q13.5,55 13,50 Z";
const INTERIOR_PATH = "M12,15 H52 L48.5,48 Q48.1,52 44.1,52 H19.9 Q15.9,52 15.5,48 Z";

/**
 * Water: a wave cresting near y=15.5 over a body that runs well past the bottom
 * of the bucket, so sliding the whole group downwards empties it completely.
 */
const WATER_PATH = "M0,18 q8,-5 16,0 t16,0 t16,0 t16,0 V162 H0 Z";

/**
 * Vertical centre for the letter, and the dy that actually puts a glyph's ink
 * there.
 *
 * Arabic glyphs carry most of their mass above the baseline and a descender
 * below, so a naive "half the font size" nudge lands the letter too low. Measured
 * against the rendered ink, `0.16em` centres it on `y` at any font size.
 */
const LETTER_Y = 33.5;
const LETTER_DY = "0.16em";

/**
 * The water colour for each state. "plain" needs no class of its own: it is what
 * the base `.bucket-water` already paints.
 */
const WATER_CLASS: Record<BucketWater, { settled: string; revealing: string }> = {
  plain: { settled: "", revealing: "" },
  present: {
    settled: "bucket-water-present",
    revealing: "animate-bucket-water-present",
  },
  correct: {
    settled: "bucket-water-correct",
    revealing: "animate-bucket-water-correct",
  },
  gray: { settled: "bucket-water-gray", revealing: "animate-bucket-water-gray" },
};

/** The letter colour, matched to whatever water it ends up sitting in. */
const INK_CLASS: Record<BucketInk, { settled: string; revealing: string }> = {
  base: { settled: "", revealing: "" },
  onGray: { settled: "bucket-letter-on-gray", revealing: "animate-bucket-ink-on-gray" },
  info: { settled: "bucket-letter-info", revealing: "animate-bucket-ink-info" },
};

const RESULT_LABEL: Record<BucketResult, string> = {
  correct: "في مكانه الصحيح",
  present: "موجود في مكان آخر",
  absent: "غير موجود",
};

export function Bucket({
  letter,
  result,
  stagger = 0,
  animate = false,
  className = "",
}: {
  /** The letter shown inside the bucket. */
  letter?: string;
  /** How the guess was marked. Undefined while the word is still being typed. */
  result?: BucketResult;
  /** Milliseconds to delay this bucket's reveal, so a row fills across in turn. */
  stagger?: number;
  /** Play the reveal. False renders the settled graphic immediately. */
  animate?: boolean;
  className?: string;
}) {
  const rawId = useId();
  const clipId = `bucket-clip-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  const appearance = bucketAppearance(result, animate);

  const waterGroupClass =
    appearance.animateWater === "fill"
      ? "animate-bucket-fill"
      : appearance.animateWater === "drain"
        ? "animate-bucket-drain"
        : "bucket-water-group";

  // While the greying keyframes run they own the colours; otherwise the class
  // carries them, which is what the keys transition through.
  const grayClass = !appearance.gray
    ? ""
    : appearance.animateGray
      ? "animate-bucket-gray-body"
      : "bucket-body-gray";

  const waterTone = WATER_CLASS[appearance.water];
  const waterClass = `bucket-water ${
    appearance.animateWaterTone ? waterTone.revealing : waterTone.settled
  }`;

  const inkTone = INK_CLASS[appearance.ink];
  const letterClass = `bucket-letter ${
    appearance.animateInk ? inkTone.revealing : inkTone.settled
  }`;

  const vesselClass = `bucket-body ${grayClass}`;
  const settleDelay = { animationDelay: `${stagger + 560}ms` };

  return (
    <svg
      viewBox="4 0 56 58"
      className={className}
      style={
        {
          "--bucket-empty": `${BUCKET_EMPTY}px`,
          "--bucket-residue": `${BUCKET_RESIDUE}px`,
        } as React.CSSProperties
      }
      role="img"
      aria-label={letter ? `${letter} — ${RESULT_LABEL[result ?? "absent"]}` : "خانة فارغة"}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={INTERIOR_PATH} />
        </clipPath>
      </defs>

      <path
        d={BODY_PATH}
        className={vesselClass}
        style={appearance.animateGray ? settleDelay : undefined}
      />

      <g clipPath={`url(#${clipId})`}>
        <g
          className={waterGroupClass}
          style={
            appearance.animateWater === null
              ? {
                  transform:
                    appearance.waterOffset === 0
                      ? "translateY(0)"
                      : `translateY(var(${
                          appearance.gray ? "--bucket-residue" : "--bucket-empty"
                        }))`,
                }
              : { animationDelay: `${stagger}ms` }
          }
        >
          <path
            d={WATER_PATH}
            className={waterClass}
            style={appearance.animateWaterTone ? settleDelay : undefined}
          />
        </g>
      </g>

      {/* Painted over the water, so the surface never reaches the brim. */}
      <rect
        x="7"
        y="3"
        width="50"
        height="10"
        rx="3"
        className={vesselClass}
        style={appearance.animateGray ? settleDelay : undefined}
      />

      <text
        x="32"
        y={LETTER_Y}
        dy={LETTER_DY}
        textAnchor="middle"
        fontSize="26"
        fontWeight="700"
        className={letterClass}
        style={appearance.animateInk ? settleDelay : undefined}
        aria-hidden="true"
      >
        {letter ?? ""}
      </text>
    </svg>
  );
}
