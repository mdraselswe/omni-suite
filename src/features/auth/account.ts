import "server-only";
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { account } from "@/server/db/schema";

/** Does the user sign in with a password (Better Auth "credential" account)? */
export async function hasPasswordAccount(database: DbOrTx, userId: string): Promise<boolean> {
  const rows = await database
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  return rows.length > 0;
}
