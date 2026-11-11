/** `pnpm db:migrate` — applies pending migrations from ./drizzle. */
import { runMigrations } from "@/server/db/migrate";

runMigrations()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
