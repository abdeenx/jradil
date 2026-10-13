/**
 * Generates the social preview card.
 *
 *     vp run og-image
 *
 * The card is the app's own wordmark — one bucket per letter of the name — over
 * a tagline. It is built from the geometry in `src/lib/bucket.ts`, the same
 * constants the board draws from, so the card cannot show a different vessel
 * from the one players see.
 *
 * Output is a PNG because social platforms will not reliably render an SVG
 * `og:image`. The rasteriser is librsvg, which brings pango and harfbuzz, so the
 * Arabic shapes properly rather than falling back to boxes.
 *
 * Re-run this whenever the wordmark, the name or the tagline changes.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUCKET_BODY_PATH,
  BUCKET_INTERIOR_PATH,
  BUCKET_LETTER_DY,
  BUCKET_LETTER_SIZE,
  BUCKET_LETTER_Y,
  BUCKET_RIM,
  BUCKET_WATER_PATH,
} from "../src/lib/bucket.ts";
import { TAGLINE_AR, WORDMARK_AR } from "../src/lib/config.ts";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "../src/lib/social.ts";

const WIDTH = OG_IMAGE_WIDTH;
const HEIGHT = OG_IMAGE_HEIGHT;

/** How tall one bucket is drawn. The width follows the artwork's own aspect. */
const BUCKET_HEIGHT = 170;
const GAP = 24;

const FONT = "system-ui, -apple-system, 'SF Arabic', 'Geeza Pro', 'Segoe UI', Tahoma, sans-serif";

/** Literal colours: a card is a fixed picture, and it is not rasterised with the theme. */
const INK = "#042E49";
const WATER = "#00BAFE";
const GLASS = "#FFFFFF";
const BACKGROUND = "#EDF6FF";
const TAGLINE_INK = "#3D6B8F";

const SCALE = BUCKET_HEIGHT / 58;
const BUCKET_WIDTH = 56 * SCALE;

/** One bucket, one letter, drawn in its own coordinate system and scaled as a whole. */
function bucket(left: number, top: number, letter: string): string {
  const rim = BUCKET_RIM;
  return `  <g transform="translate(${left.toFixed(2)} ${top}) scale(${SCALE.toFixed(4)})">
    <path d="${BUCKET_BODY_PATH}" fill="${GLASS}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <g clip-path="url(#interior)">
      <path d="${BUCKET_WATER_PATH}" fill="${WATER}"/>
    </g>
    <rect x="${rim.x}" y="${rim.y}" width="${rim.width}" height="${rim.height}" rx="${rim.rx}" fill="${INK}"/>
    <text x="32" y="${BUCKET_LETTER_Y}" dy="${BUCKET_LETTER_DY}" text-anchor="middle" font-family="${FONT}" font-size="${BUCKET_LETTER_SIZE}" font-weight="700" fill="${INK}">${letter}</text>
  </g>`;
}

const letters = Array.from(WORDMARK_AR);
const rowWidth = letters.length * BUCKET_WIDTH + (letters.length - 1) * GAP;

const TAGLINE_SIZE = 40;
const TAGLINE_GAP = 52;

const blockHeight = BUCKET_HEIGHT + TAGLINE_GAP + TAGLINE_SIZE * 1.4;
const rowTop = Math.round((HEIGHT - blockHeight) / 2);
const rowLeft = Math.round((WIDTH - rowWidth) / 2);

const taglineY = Math.round(rowTop + BUCKET_HEIGHT + TAGLINE_GAP + (TAGLINE_SIZE * 1.4) / 2);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <clipPath id="interior">
      <path d="${BUCKET_INTERIOR_PATH}"/>
    </clipPath>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>

  <!-- Right to left, the way the name is read: ك ر ا د ل is drawn leftwards. -->
${letters
  .map((letter, index) =>
    bucket(rowLeft + (letters.length - 1 - index) * (BUCKET_WIDTH + GAP), rowTop, letter),
  )
  .join("\n")}

  <text x="${WIDTH / 2}" y="${taglineY}" dy="0.355em" text-anchor="middle" font-family="${FONT}" font-size="${TAGLINE_SIZE}" font-weight="600" fill="${TAGLINE_INK}">${TAGLINE_AR}</text>
</svg>
`;

const workdir = mkdtempSync(join(tmpdir(), "jradil-og-"));
const svgPath = join(workdir, "og-image.svg");
const outPath = new URL("../public/og-image.png", import.meta.url).pathname;

writeFileSync(svgPath, svg);
execFileSync("rsvg-convert", ["-w", String(WIDTH), "-h", String(HEIGHT), svgPath, "-o", outPath]);

console.log(`wrote public/og-image.png (${WIDTH}x${HEIGHT})`);
console.log(`  wordmark: ${letters.length} buckets, ${rowWidth}px wide, starting at x=${rowLeft}`);
console.log(`  tagline:  "${TAGLINE_AR}"`);

// Printed because the row is mirrored: the first letter of the name has to end up
// in the rightmost bucket, and that is only obvious from the numbers.
console.log("  layout, left to right:");
for (const [index, letter] of letters.entries()) {
  const x = rowLeft + (letters.length - 1 - index) * (BUCKET_WIDTH + GAP);
  console.log(`    ${letter}  x=${Math.round(x)}`);
}
