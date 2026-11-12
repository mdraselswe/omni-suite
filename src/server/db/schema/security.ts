import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Fixed-window counters for abuse limits (mail quotas, sign-in throttle, AI caps
 * per member). One row per key and window; expired rows are pruned by the worker.
 * See src/server/rate-limit.ts.
 */
export const rateCounters = pgTable(
  "rate_counters",
  {
    key: text("key").notNull(),
    /** Window number: floor(epoch ms / window length). */
    bucket: text("bucket").notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.bucket] }), index("rate_counters_expires_idx").on(t.expiresAt)],
);
