/**
 * Operator authentication.
 *
 * Deliberately small: one shared password from the environment, exchanged for a
 * short-lived signed session cookie. There are no admin accounts to store, so
 * the single collection stays reserved for the game's own data.
 *
 * Set `ADMIN_PASSWORD` in `.env`. `ADMIN_SESSION_SECRET` is optional; when it is
 * absent the password doubles as the signing key, which is safe because knowing
 * the password already grants admin access.
 */

import "@tanstack/react-start/server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { optionalEnv } from "./env.ts";

const COOKIE_NAME = "jradil_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type AdminSession = {
  /** False when `ADMIN_PASSWORD` has not been configured on the server. */
  configured: boolean;
  authenticated: boolean;
  expiresAt: number | null;
};

function signingKey(): string | null {
  return optionalEnv("ADMIN_SESSION_SECRET") ?? optionalEnv("ADMIN_PASSWORD");
}

function sign(payload: string): string {
  const key = signingKey();
  if (!key) throw new Error("ADMIN_PASSWORD is not configured");
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
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

export function loginBlockedFor(identifier: string): number {
  const attempt = attempts.get(identifier);
  if (!attempt) return 0;
  return Math.max(0, attempt.blockedUntil - Date.now());
}

export function recordLoginFailure(identifier: string): void {
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
