import { describe, expect, it } from "vite-plus/test";

import {
  isLinkPreviewAgent,
  legacyAction,
  matchLegacyHost,
  parseLegacyHosts,
  requestHost,
  withForwardScript,
  type LegacyRequest,
} from "./legacy-host.ts";

const OLD = "jradil.abdeenx.com";
const NEW = "https://jradil.geekoland.com";
const options = { legacyHosts: [OLD], appUrl: NEW };

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** A browser opening a page: what every current browser sends on navigation. */
function request(overrides: Partial<LegacyRequest> = {}): LegacyRequest {
  return {
    host: OLD,
    method: "GET",
    pathname: "/",
    search: "",
    userAgent: CHROME,
    fetchMode: "navigate",
    fetchDest: "document",
    ...overrides,
  };
}

function headers(entries: Record<string, string>) {
  return { get: (name: string) => entries[name] ?? null };
}

describe("parseLegacyHosts", () => {
  it("reads a list separated by commas or spaces", () => {
    expect(parseLegacyHosts("a.example.com, b.example.com c.example.com")).toEqual([
      "a.example.com",
      "b.example.com",
      "c.example.com",
    ]);
  });

  it("accepts full addresses and odd casing", () => {
    expect(parseLegacyHosts("https://Jradil.AbdeenX.com/")).toEqual([OLD]);
  });

  it("is empty when unset", () => {
    expect(parseLegacyHosts(null)).toEqual([]);
    expect(parseLegacyHosts("  ")).toEqual([]);
  });
});

describe("requestHost", () => {
  it("prefers the forwarded host, without its port", () => {
    expect(requestHost(headers({ host: "app:3000", "x-forwarded-host": `${OLD}, proxy` }))).toBe(
      OLD,
    );
  });

  it("falls back to Host", () => {
    expect(requestHost(headers({ host: "JRADIL.abdeenx.com:443" }))).toBe(OLD);
  });
});

describe("matchLegacyHost", () => {
  it("only matches configured hosts", () => {
    expect(matchLegacyHost(OLD, [OLD])).toBe(OLD);
    expect(matchLegacyHost("jradil.geekoland.com", [OLD])).toBeNull();
    expect(matchLegacyHost(null, [OLD])).toBeNull();
  });
});

describe("isLinkPreviewAgent", () => {
  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "WhatsApp/2.23.20.0 A",
    "Twitterbot/1.0",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  ])("recognises %s", (agent) => {
    expect(isLinkPreviewAgent(agent)).toBe(true);
  });

  it("does not take browsers or search engines for preview fetchers", () => {
    expect(isLinkPreviewAgent(CHROME)).toBe(false);
    expect(
      isLinkPreviewAgent(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      ),
    ).toBe(false);
    expect(isLinkPreviewAgent(null)).toBe(false);
  });
});

describe("legacyAction", () => {
  it("redirects a browser opening a page to the same page on the new host", () => {
    expect(legacyAction(request(), options)).toEqual({ kind: "redirect", location: `${NEW}/` });
    expect(legacyAction(request({ pathname: "/leaderboard", search: "?a=1" }), options)).toEqual({
      kind: "redirect",
      location: `${NEW}/leaderboard?a=1`,
    });
  });

  it("serves the page with a forwarding script to a fetch that is not a navigation", () => {
    // WhatsApp's desktop and web apps: a browser's user agent, no navigation headers.
    expect(legacyAction(request({ fetchMode: null, fetchDest: null }), options)).toEqual({
      kind: "forward",
      location: `${NEW}/`,
    });
    expect(legacyAction(request({ fetchMode: "cors", fetchDest: "empty" }), options)).toEqual({
      kind: "forward",
      location: `${NEW}/`,
    });
  });

  it("keeps serving link-preview crawlers on the old host", () => {
    expect(legacyAction(request({ userAgent: "WhatsApp/2.23.20.0 A" }), options)).toBeNull();
    expect(
      legacyAction(
        request({ userAgent: "facebookexternalhit/1.1", fetchMode: null, fetchDest: null }),
        options,
      ),
    ).toBeNull();
  });

  it("keeps files and the API reachable on the old host", () => {
    for (const pathname of ["/og-image.png", "/sw.js", "/assets/main-abc.js", "/favicon.ico"]) {
      expect(legacyAction(request({ pathname }), options)).toBeNull();
    }
    expect(legacyAction(request({ pathname: "/api/push" }), options)).toBeNull();
    expect(legacyAction(request({ pathname: "/_serverFn/abc" }), options)).toBeNull();
    expect(legacyAction(request({ method: "POST" }), options)).toBeNull();
  });

  it("leaves the new host alone", () => {
    expect(legacyAction(request({ host: "jradil.geekoland.com" }), options)).toBeNull();
  });

  it("does nothing without somewhere to send people", () => {
    expect(legacyAction(request(), { legacyHosts: [OLD], appUrl: null })).toBeNull();
    expect(legacyAction(request(), { legacyHosts: [OLD], appUrl: "not a url" })).toBeNull();
  });

  it("never redirects a host to itself", () => {
    expect(legacyAction(request(), { legacyHosts: [OLD], appUrl: `https://${OLD}` })).toBeNull();
  });
});

describe("withForwardScript", () => {
  const page =
    '<!DOCTYPE html><html lang="ar"><head><meta charset="utf-8"/></head><body></body></html>';

  it("puts the script first in the head", () => {
    expect(withForwardScript(page, `${NEW}/`)).toBe(
      `<!DOCTYPE html><html lang="ar"><head><script>location.replace("${NEW}/"+location.hash)</script><meta charset="utf-8"/></head><body></body></html>`,
    );
  });

  it("cannot be broken out of by the request's own path", () => {
    const html = withForwardScript(page, `${NEW}/</script><script>alert(1)//`);
    expect(html).not.toContain("</script><script>alert");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});
