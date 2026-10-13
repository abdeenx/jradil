import { memo, useId } from "react";

import {
  BUCKET_BODY_PATH,
  BUCKET_EMPTY,
  BUCKET_INTERIOR_PATH,
  BUCKET_LETTER_DY,
  BUCKET_LETTER_SIZE,
  BUCKET_LETTER_Y,
  BUCKET_RESIDUE,
  BUCKET_RIM,
  BUCKET_VIEWBOX,
  BUCKET_WATER_PATH,
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
 * taper, and a rim band that barely overhangs the body. The geometry itself
 * lives in `#/lib/bucket.ts`, shared with the tab icon and the generated social
 * card so all three draw the same vessel.
 */
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

/**
 * Memoised: a board and keypad draw nearly sixty of these, and a keystroke
 * changes at most one of them. Every prop is a primitive, so the shallow
 * comparison is exact.
 */
export const Bucket = memo(function Bucket({
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
      viewBox={BUCKET_VIEWBOX}
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
          <path d={BUCKET_INTERIOR_PATH} />
        </clipPath>
      </defs>

      <path
        d={BUCKET_BODY_PATH}
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
            d={BUCKET_WATER_PATH}
            className={waterClass}
            style={appearance.animateWaterTone ? settleDelay : undefined}
          />
        </g>
      </g>

      {/* Painted over the water, so the surface never reaches the brim. */}
      <rect
        x={BUCKET_RIM.x}
        y={BUCKET_RIM.y}
        width={BUCKET_RIM.width}
        height={BUCKET_RIM.height}
        rx={BUCKET_RIM.rx}
        className={vesselClass}
        style={appearance.animateGray ? settleDelay : undefined}
      />

      <text
        x="32"
        y={BUCKET_LETTER_Y}
        dy={BUCKET_LETTER_DY}
        textAnchor="middle"
        fontSize={BUCKET_LETTER_SIZE}
        fontWeight="700"
        className={letterClass}
        style={appearance.animateInk ? settleDelay : undefined}
        aria-hidden="true"
      >
        {letter ?? ""}
      </text>
    </svg>
  );
});
