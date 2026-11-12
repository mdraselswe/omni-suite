import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { disabledAccess, invitationsForEmail } from "@/features/team";
import { t } from "@/i18n";
import { appHref, tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { userTenants } from "@/server/tenancy/service";

/**
 * Landing after sign-in. Someone who belongs to a business (or was invited to
 * one) goes there; only a person with nothing at all is offered to create a
 * business, so invited clients and staff never end up in that flow.
 */
export default async function Home() {
  const user = await requireUser();
  const database = db();
  const [tenants, invites, disabled] = await Promise.all([
    userTenants(database, user.id),
    // Invitations are only matched to an address the user has proven.
    user.emailVerified ? invitationsForEmail(database, user.email) : Promise.resolve([]),
    disabledAccess(database, user.id),
  ]);
  const open = invites.filter((i) => !i.expired);
  const [onlyInvite] = open;
  if (tenants.length === 0 && open.length === 1 && invites.length === 1 && onlyInvite) {
    redirect(appHref(`/invite/${onlyInvite.token}`));
  }
  if (tenants.length === 0 && invites.length === 0 && disabled.length === 0) redirect("/onboarding");
  const [only] = tenants;
  if (tenants.length === 1 && invites.length === 0 && only) {
    redirect(tenantHref(only.slug, only.kind === "client" ? "portal" : ""));
  }
  const onlyClient = tenants.length > 0 && tenants.every((tn) => tn.kind === "client");

  return (
    <main id="content" className="mx-auto grid min-h-svh w-full max-w-md content-center gap-6 px-4 py-12">
      {tenants.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="home-pick">
          <h1 id="home-pick" className="font-heading text-2xl font-semibold">
            {t("home.pick")}
          </h1>
          <ul className="grid gap-2">
            {tenants.map((tn) => (
              <li key={tn.slug}>
                <Link
                  href={tenantHref(tn.slug, tn.kind === "client" ? "portal" : "")}
                  className="flex items-center justify-between gap-3 surface p-4 hover:bg-accent"
                >
                  <span className="font-medium">{tn.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {tn.kind === "client" ? t("home.clientAccess") : t("home.teamAccess")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invites.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="home-invites">
          {tenants.length > 0 ? (
            <h2 id="home-invites" className="font-heading text-lg font-semibold">
              {t("access.home.invitations")}
            </h2>
          ) : (
            <h1 id="home-invites" className="font-heading text-2xl font-semibold">
              {t("access.home.invitations")}
            </h1>
          )}
          <ul className="grid gap-2">
            {invites.map((inv) => (
              <li key={inv.token} className="flex flex-wrap items-center justify-between gap-3 surface p-4">
                <span className="grid gap-0.5">
                  <span className="font-medium">{inv.business}</span>
                  <span className="text-xs text-muted-foreground">
                    {inv.expired
                      ? t("access.home.expired", { business: inv.business })
                      : inv.kind === "client"
                        ? t("home.clientAccess")
                        : t("home.teamAccess")}
                  </span>
                </span>
                {inv.expired ? null : (
                  <Link href={appHref(`/invite/${inv.token}`)} className={buttonVariants({ size: "sm" })}>
                    {t("access.home.view")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tenants.length === 0 && invites.length === 0 ? (
        <h1 className="font-heading text-2xl font-semibold">{t("access.home.noAccessTitle")}</h1>
      ) : null}
      {disabled.length > 0 ? (
        <Alert>
          <AlertDescription>{t("access.home.disabled", { business: disabled.join(", ") })}</AlertDescription>
        </Alert>
      ) : null}

      {onlyClient ? null : (
        <div className="grid gap-1">
          {tenants.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("access.home.orCreate")}</p>
          ) : null}
          <Link href="/onboarding" className={buttonVariants({ variant: "outline" })}>
            {t("shell.newBusiness")}
          </Link>
        </div>
      )}
    </main>
  );
}
