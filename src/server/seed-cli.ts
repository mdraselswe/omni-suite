/**
 * `pnpm db:seed` — applies migrations, then loads the local demo data.
 * Runs under tsx with scripts/lib/server-only-hook.mjs (see package.json).
 */
import { serverEnv } from "@/config/env";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/features/auth";
import { db } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { DEMO_SLUG, seed } from "@/server/seed";

async function main() {
  await runMigrations();
  const result = await seed(db(), { adminEmails: serverEnv().PLATFORM_ADMIN_EMAILS });
  console.log(`Demo business "/${DEMO_SLUG}": ${result.demo}. OmniScope business: ${result.home}.`);
  console.log(`Demo sign-ins (password ${DEMO_PASSWORD}):`);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.label.padEnd(18)} ${a.email}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
