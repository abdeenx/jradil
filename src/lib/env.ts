/**
 * Minimal `.env` loading for server-side code.
 *
 * Vite only exposes `VITE_`-prefixed variables to `process.env`, so the server
 * reads `.env` itself. Real environment variables always win, which keeps the
 * production host (Docker, Render, Fly, PM2) authoritative.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let loaded = false;

function applyEnvFile(file: string): void {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    // Never clobber a value the host already provided.
    if (key === "" || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    process.env[key] = value;
  }
}

/** Loads `.env.local` then `.env` from the working directory and its parent. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const start = process.cwd();
  const directories = [start, dirname(start)];

  for (const name of [".env.local", ".env"]) {
    for (const directory of directories) {
      const file = join(directory, name);
      if (existsSync(file)) applyEnvFile(file);
    }
  }
}

export function optionalEnv(name: string): string | null {
  loadEnv();
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (value === null) {
    throw new Error(`متغير البيئة ${name} غير موجود. أضفه إلى ملف .env أو إلى بيئة التشغيل.`);
  }
  return value;
}
