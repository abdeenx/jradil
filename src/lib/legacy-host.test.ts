import { describe, expect, it } from "vite-plus/test";

import {
  isLinkPreviewAgent,
  legacyRedirect,
  matchLegacyHost,
  parseLegacyHosts,
  requestHost,
  type LegacyRequest,
} from "./legacy-host.ts";

const OLD = "jradil.abdeenx.com";
const NEW = "https://jradil.geekoland.com";
const options = { legacyHosts: [OLD], appUrl: NEW };

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function request(overrides: Partial<LegacyRequest> = {}): LegacyRequest {
  return { host: OLD, method: "GET", pathname: "/", search: "", userAgent: CHROME, ...overrides };
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

describe("legacyRedirect", () => {
  it("sends a browser on the old host to the same page on the new one", () => {
    expect(legacyRedirect(request(), options)).toBe(`${NEW}/`);
    expect(legacyRedirect(request({ pathname: "/leaderboard", search: "?a=1" }), options)).toBe(
      `${NEW}/leaderboard?a=1`,
    );
  });

  it("keeps serving link-preview crawlers on the old host", () => {
    expect(legacyRedirect(request({ userAgent: "WhatsApp/2.23.20.0 A" }), options)).toBeNull();
  });

  it("keeps files and the API reachable on the old host", () => {
    for (const pathname of ["/og-image.png", "/sw.js", "/assets/main-abc.js", "/favicon.ico"]) {
      expect(legacyRedirect(request({ pathname }), options)).toBeNull();
    }
    expect(legacyRedirect(request({ pathname: "/api/push" }), options)).toBeNull();
    expect(legacyRedirect(request({ pathname: "/_serverFn/abc" }), options)).toBeNull();
    expect(legacyRedirect(request({ method: "POST" }), options)).toBeNull();
  });

  it("leaves the new host alone", () => {
    expect(legacyRedirect(request({ host: "jradil.geekoland.com" }), options)).toBeNull();
  });

  it("does nothing without somewhere to send people", () => {
    expect(legacyRedirect(request(), { legacyHosts: [OLD], appUrl: null })).toBeNull();
    expect(legacyRedirect(request(), { legacyHosts: [OLD], appUrl: "not a url" })).toBeNull();
  });

  it("never redirects a host to itself", () => {
    expect(legacyRedirect(request(), { legacyHosts: [OLD], appUrl: `https://${OLD}` })).toBeNull();
  });
});
