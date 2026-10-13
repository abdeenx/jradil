/**
 * Operator authentication.
 *
 * Deliberately small: one shared password from the environment, exchanged for a
 * short-lived signed session cookie. There are no admin accounts to store, so
 * the single collection stays reserved for the game's own data.
 *
 * Set `ADMIN_PASSWORD` in `.env`. `ADMIN_SESSION_SECRET` is optional. The
 * signing key is stretched from both with scrypt, so a leaked cookie is not a
 * fast offline oracle for the password, and changing either one signs every
 * existing session out.
 */

import "@tanstack/react-start/server-only";

import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";

import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestIP,
  setCookie,
} from "@tanstack/react-start/server";

import { optionalEnv } from "./env.ts";

const COOKIE_NAME = "jradil_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type AdminSession = {
  /** False when `ADMIN_PASSWORD` has not been configured on the server. */
  configured: boolean;
  authenticated: boolean;
  expiresAt: number | null;
};

/** Derived once per secret/password pair: scrypt is deliberately slow. */
let derivedKey: { material: string; key: Buffer } | null = null;

function signingKey(): Buffer | null {
  const password = optionalEnv("ADMIN_PASSWORD");
  if (!password) return null;
  const material = `${optionalEnv("ADMIN_SESSION_SECRET") ?? ""}\0${password}`;
  if (derivedKey?.material !== material) {
    derivedKey = { material, key: scryptSync(material, "jradil-admin-session", 32) };
  }
  return derivedKey.key;
}

function sign(payload: string): string {
  const key = signingKey();
  if (!key) throw new Error("ADMIN_PASSWORD is not configured");
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Compares digests, so neither the content nor the length of a secret leaks. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function isAdminConfigured(): boolean {
  return (optionalEnv("ADMIN_PASSWORD") ?? "").length > 0;
}

export function verifyPassword(input: string): boolean {
  const expected = optionalEnv("ADMIN_PASSWORD");
  if (!expected || input.length === 0) return false;
  return constantTimeEquals(input, expected);
}

export function issueSession(): number {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = `${expiresAt}.${sign(String(expiresAt))}`;
  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return expiresAt;
}

export function clearSession(): void {
  deleteCookie(COOKIE_NAME, { path: "/" });
}

export function readSession(): AdminSession {
  if (!isAdminConfigured()) {
    return { configured: false, authenticated: false, expiresAt: null };
  }

  const raw = getCookie(COOKIE_NAME);
  if (!raw) return { configured: true, authenticated: false, expiresAt: null };

  const separator = raw.lastIndexOf(".");
  if (separator === -1) return { configured: true, authenticated: false, expiresAt: null };

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expiresAt = Number(payload);

  const validSignature = constantTimeEquals(signature, sign(payload));
  const notExpired = Number.isFinite(expiresAt) && expiresAt > Date.now();

  if (!validSignature || !notExpired) {
    return { configured: true, authenticated: false, expiresAt: null };
  }
  return { configured: true, authenticated: true, expiresAt };
}

/** Throws for any admin server function called without a valid session. */
export function requireAdmin(): AdminSession {
  const session = readSession();
  if (!session.configured) {
    throw new Error("لم يتم إعداد ADMIN_PASSWORD على الخادم");
  }
  if (!session.authenticated) {
    throw new Error("غير مصرّح: يلزم تسجيل الدخول");
  }
  return session;
}

// ------------------------------------------------------- login throttling --

type Attempt = { failures: number; blockedUntil: number };

const globalForThrottle = globalThis as unknown as { __jradilLoginAttempts?: Map<string, Attempt> };
const attempts = (globalForThrottle.__jradilLoginAttempts ??= new Map<string, Attempt>());

const MAX_FAILURES = 8;
const BLOCK_MS = 5 * 60 * 1000;
/** Bounds the map, so a flood of addresses cannot grow it without limit. */
const MAX_TRACKED = 10_000;

/**
 * Who is attempting to log in, keyed by client address.
 *
 * Keying by address means a stranger guessing passwords locks out only
 * themselves, not the operator. `X-Forwarded-For` is honoured only when
 * `TRUST_PROXY=true`, and then only its last hop — the one the proxy itself
 * appended — because every earlier entry is whatever the client chose to send.
 */
export function loginIdentifier(): string {
  if (optionalEnv("TRUST_PROXY") === "true") {
    const forwarded = getRequestHeader("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  return getRequestIP() ?? "unknown";
}

function pruneAttempts(now: number): void {
  for (const [key, attempt] of attempts) {
    if (attempt.blockedUntil <= now && attempt.failures === 0) attempts.delete(key);
  }
  // Still full of live entries: drop the oldest, which a Map iterates first.
  for (const key of attempts.keys()) {
    if (attempts.size < MAX_TRACKED) break;
    attempts.delete(key);
  }
}

export function loginBlockedFor(identifier: string): number {
  const attempt = attempts.get(identifier);
  if (!attempt) return 0;
  return Math.max(0, attempt.blockedUntil - Date.now());
}

export function recordLoginFailure(identifier: string): void {
  if (!attempts.has(identifier) && attempts.size >= MAX_TRACKED) pruneAttempts(Date.now());
  const attempt = attempts.get(identifier) ?? { failures: 0, blockedUntil: 0 };
  attempt.failures += 1;
  if (attempt.failures >= MAX_FAILURES) {
    attempt.failures = 0;
    attempt.blockedUntil = Date.now() + BLOCK_MS;
  }
  attempts.set(identifier, attempt);
}

export function recordLoginSuccess(identifier: string): void {
  attempts.delete(identifier);
}
