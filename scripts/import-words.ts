/**
 * Bulk word import from the command line.
 *
 *     node scripts/import-words.ts words.csv
 *     node scripts/import-words.ts words.json
 *     cat words.txt | node scripts/import-words.ts -
 *
 * The same parser backs the import panel in the admin dashboard; this entry
 * point exists for files that are easier to hand to a shell than to paste.
 * Re-running it is safe: words match on their folded spelling and flags are only
 * overwritten when the payload states them explicitly.
 *
 * Environment comes from `.env` (see `src/lib/env.ts`), so `MONGODB_URI` and the
 * optional `MONGODB_DB` are read the same way the app reads them.
 */

import { readFileSync } from "node:fs";

import mongoose from "mongoose";

import { connectDb, ensureSchema, mongoDbName } from "../src/lib/db.ts";
import { loadEnv } from "../src/lib/env.ts";
import { Word } from "../src/lib/jradil-model.ts";
import { importWords } from "../src/lib/word-import.ts";

/** Current dictionary size, for the before/after line. */
function countWords(): Promise<number> {
  return Word.countDocuments({});
}

loadEnv();

const source = process.argv[2];
if (!source) {
  console.error("الاستخدام: node scripts/import-words.ts <ملف|->");
  process.exit(2);
}

const payload = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");

try {
  const connection = await connectDb();
  await ensureSchema();

  const before = await countWords();
  const summary = await importWords(payload);
  const after = await countWords();

  console.log(`قاعدة البيانات: ${mongoDbName() ?? connection.connection.name}`);
  console.log(`صفوف مقروءة: ${summary.received}`);
  console.log(`أُضيفت: ${summary.inserted}`);
  console.log(`موجودة مسبقًا: ${summary.matched}`);
  console.log(`متخطّاة: ${summary.skipped.length}`);
  console.log(`إجمالي كلمات القاموس: ${before} ← ${after}`);

  if (summary.truncated) {
    console.warn("تنبيه: الملف أكبر من الحد المسموح، وتمّت قراءة أول 50000 صف فقط.");
  }
  if (summary.skipped.length > 0) {
    console.warn("\nأمثلة على الصفوف المتخطّاة:");
    for (const item of summary.skipped.slice(0, 20)) {
      console.warn(`  ${item.text} — ${item.reason}`);
    }
  }
  if (summary.received === 0) {
    console.error("\nلم يُعثر على كلمات في الملف. تحقق من الصيغة.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error("فشل الاستيراد:", (error as Error).message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
