/**
 * The social card metadata.
 *
 * Kept as a plain function of the app's public address so the tags can be
 * checked without a server or a database — the game page's loader is the only
 * thing that supplies the address at runtime.
 */

import { APP_NAME_AR, DESCRIPTION_AR, TAGLINE_AR, TITLE_AR } from "./config.ts";

/**
 * The size every platform expects for a wide card, and the size the generated
 * PNG is actually written at. `scripts/og-image.ts` imports these, and a test
 * reads them back out of the PNG, so the declaration cannot drift from the file.
 */
export const OG_IMAGE_PATH = "/og-image.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Loose shape of a `<meta>` tag, matching what the router's `head` accepts. */
export type MetaTag = { name?: string; property?: string; content: string };

/**
 * Builds the Open Graph and Twitter tags for the game page.
 *
 * Absolute addresses are required — Facebook will not reliably resolve a
 * relative `og:image` — so `appUrl` comes from `APP_URL`. Without it the image
 * is emitted as a path, which some clients still resolve against the page
 * rather than showing nothing at all.
 */
export function socialMeta(appUrl: string | null): MetaTag[] {
  // A trailing slash on the configured address would produce a double slash.
  const base = appUrl?.replace(/\/+$/, "") ?? "";
  const image = base ? `${base}${OG_IMAGE_PATH}` : OG_IMAGE_PATH;
  const alt = `${TAGLINE_AR} - ${APP_NAME_AR}`;

  return [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: APP_NAME_AR },
    { property: "og:title", content: TITLE_AR },
    { property: "og:description", content: DESCRIPTION_AR },
    // Sudan, in Arabic. There is no region subtag for the dialect.
    { property: "og:locale", content: "ar_SD" },
    { property: "og:image", content: image },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
    { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
    { property: "og:image:alt", content: alt },
    ...(base ? [{ property: "og:url", content: `${base}/` }] : []),

    // The wide card, so the wordmark is shown rather than a small thumbnail.
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE_AR },
    { name: "twitter:description", content: DESCRIPTION_AR },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: alt },
  ];
}
