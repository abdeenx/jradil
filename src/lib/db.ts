/**
 * MongoDB connection handling.
 *
 * This module is server-only: it imports Mongoose, which must never reach a
 * browser bundle. `server-only` makes that a build error instead of a runtime
 * surprise.
 */

import "@tanstack/react-start/server-only";

import mongoose from "mongoose";

import { optionalEnv, requireEnv } from "./env.ts";
import { Day, Settings, Word } from "./jradil-model.ts";

type ConnectionCache = { promise: Promise<typeof mongoose> | null };

// Survives Vite's module reloading in development, so hot reloads reuse one pool.
const globalForConnection = globalThis as unknown as {
  __jradilConnection?: ConnectionCache;
};

const cache: ConnectionCache = (globalForConnection.__jradilConnection ??= { promise: null });
globalForConnection.__jradilConnection = cache;

/** The MongoDB URI, or a readable Arabic error when it is missing. */
export function mongoUri(): string {
  return requireEnv("MONGODB_URI");
}

/**
 * Database name.
 *
 * Optional: when it is unset the URI decides, which is the right default for a
 * hosted cluster. Set `MONGODB_DB` to keep the game's data in its own database
 * when the connection string carries no name of its own.
 */
export function mongoDbName(): string | undefined {
  return optionalEnv("MONGODB_DB") ?? undefined;
}

/** Connects once per process and reuses the pool for every later call. */
export async function connectDb(): Promise<typeof mongoose> {
  if (cache.promise) return cache.promise;

  cache.promise = mongoose
    .connect(mongoUri(), {
      dbName: mongoDbName(),
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 10,
      // Indexes are built explicitly by {@link ensureSchema}, not on connect.
      autoIndex: false,
    })
    .catch((error: unknown) => {
      // Let the next call retry instead of caching a failed connection forever.
      cache.promise = null;
      throw error;
    });

  return cache.promise;
}

let schemaReady: Promise<void> | null = null;

/**
 * Ensures the collection and its indexes exist.
 *
 * Index creation is idempotent and safe to call on every request, but it only
 * runs once per process. A conflicting pre-existing index is reported rather
 * than fatal, so a partially-migrated database still serves the game.
 */
export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await connectDb();
    for (const model of [Word, Day, Settings]) {
      try {
        await model.createIndexes();
      } catch (error) {
        console.warn(`[jradil] تعذّر إنشاء فهارس المجموعة للنموذج "${model.modelName}":`, error);
      }
    }
  })().catch((error: unknown) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

/** True when the database answers a trivial command. Used by the admin health check. */
export async function pingDatabase(): Promise<boolean> {
  try {
    const connection = await connectDb();
    await connection.connection.db?.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
