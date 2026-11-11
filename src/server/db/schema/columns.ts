import { sql } from "drizzle-orm";
import { bigint, date, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "@/lib/ids";

/** Shared column builders so every table follows the same conventions. */
export const pk = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

export const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Minor units (cents). Always bigint in JS. */
export const money = (name: string) =>
  bigint(name, { mode: "bigint" })
    .notNull()
    .default(sql`0`);

/** Calendar date as an ISO string (YYYY-MM-DD). */
export const day = (name: string) => date(name, { mode: "string" });
