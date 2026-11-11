import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { site } from "@/config";
import { t } from "@/i18n";
import { appHref } from "@/lib/href";
import { memberBusinessName } from "@/server/auth/handoff-access";
import { safeNextPath } from "@/server/auth/redirect";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { cleanHost, slugForHost } from "@/server/tenancy/hosts";

export const metadata: Metadata = { title: "Continue" };

/**
 * Custom-domain sign-in, step 2 (on the app host): the user confirms before a
 * session is created on the business's own domain. Never silent.
 */
export default async function HandoffConfirmPage({ searchParams }: PageProps<"/login/handoff">) {
  const query = await searchParams;
  const host = cleanHost(typeof query.host === "string" ? query.host : "");
  const next = safeNextPath(query.next);
  const slug = await slugForHost(host);
  const user = slug ? await getSessionUser() : null;
  if (slug && !user) {
    const back = `/login/handoff/?${new URLSearchParams({ host, next }).toString()}`;
    redirect(appHref(`/login/?next=${encodeURIComponent(back)}`));
  }
  const business = slug && user ? await memberBusinessName(db(), user.id, slug) : null;

  return (
    <main id="content" className="mx-auto grid min-h-svh max-w-md content-center gap-6 px-4 py-12">
      <div className="flex items-center gap-2.5">
        <BrandMark name={site.name} className="size-9" />
        <span className="font-heading text-lg font-semibold">{site.name}</span>
      </div>
      {!slug ? (
        <div className="grid gap-2">
          <h1 className="font-heading text-2xl font-semibold">{t("handoff.invalidTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("handoff.invalid", { host: host || "—" })}</p>
          <ButtonLink href="/" variant="outline" className="justify-self-start">
            {t("notFound.cta")}
          </ButtonLink>
        </div>
      ) : !business ? (
        <div className="grid gap-2">
          <h1 className="font-heading text-2xl font-semibold">{t("handoff.notMemberTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("handoff.notMember", { email: user?.email ?? "", host })}
          </p>
          <ButtonLink href="/" variant="outline" className="justify-self-start">
            {t("notFound.cta")}
          </ButtonLink>
        </div>
      ) : (
        <form method="post" action="/api/handoff/start/" className="grid gap-4">
          <div className="grid gap-2">
            <h1 className="font-heading text-2xl font-semibold">{t("handoff.title", { name: business })}</h1>
            <p className="text-sm text-muted-foreground">
              {t("handoff.body", { name: business, host, email: user?.email ?? "" })}
            </p>
          </div>
          <input type="hidden" name="host" value={host} />
          <input type="hidden" name="next" value={next} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" className="break-all">
              {t("handoff.continue", { host })}
            </Button>
            <ButtonLink href="/" variant="ghost" size="lg">
              {t("handoff.cancel")}
            </ButtonLink>
          </div>
        </form>
      )}
    </main>
  );
}
