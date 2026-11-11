import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { userTenants } from "@/server/tenancy/service";

/** Landing after sign-in: go straight to the only business, or pick one. */
export default async function Home() {
  const user = await requireUser();
  const tenants = await userTenants(db(), user.id);
  if (tenants.length === 0) redirect("/onboarding");
  const [only] = tenants;
  if (tenants.length === 1 && only) {
    redirect(tenantHref(only.slug, only.kind === "client" ? "portal" : ""));
  }
  return (
    <main id="content" className="mx-auto grid min-h-svh max-w-md content-center gap-6 px-4 py-12">
      <h1 className="font-heading text-2xl font-semibold">{t("home.pick")}</h1>
      <ul className="grid gap-2">
        {tenants.map((tn) => (
          <li key={tn.slug}>
            <Link
              href={tenantHref(tn.slug, tn.kind === "client" ? "portal" : "")}
              className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-accent"
            >
              <span className="font-medium">{tn.name}</span>
              <span className="text-xs text-muted-foreground">
                {tn.kind === "client" ? t("home.clientAccess") : t("home.teamAccess")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/onboarding" className={buttonVariants({ variant: "outline" })}>
        {t("shell.newBusiness")}
      </Link>
    </main>
  );
}
