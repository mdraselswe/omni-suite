import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button-link";
import { serverEnv } from "@/config/env";
import { billingView } from "@/features/billing";
import { markNotificationsReadAction } from "@/features/settings";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { tenantHref } from "@/lib/href";
import { SIDEBAR_COOKIE } from "@/lib/shell";
import { tenantTheme, themeCss } from "@/lib/theme";
import { db } from "@/server/db";
import { getRequestSession, requireTenant } from "@/server/auth/session";
import { listNotifications, unreadCount } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";
import { navFor } from "@/server/tenancy/nav";
import { userTenants } from "@/server/tenancy/service";

/** Subscription states in which the business must fix its payment. */
const PAYMENT_DUE = new Set(["past_due", "unpaid"]);

export default async function TenantLayout({ children, params }: LayoutProps<"/[tenant]">) {
  const { tenant: slug } = await params;
  const ctx = await requireTenant(slug);
  const database = db();
  const internal = ctx.membership.kind === "internal";
  const [tenants, notes, unread, cookieStore, session, billingState] = await Promise.all([
    userTenants(database, ctx.user.id),
    listNotifications(database, ctx.tenant.id, ctx.user.id, 15),
    unreadCount(database, ctx.tenant.id, ctx.user.id),
    cookies(),
    getRequestSession(),
    internal ? billingView(database, ctx.tenant) : Promise.resolve(null),
  ]);
  // On a custom domain the session belongs to this business only: no switching, account lives on the app host.
  const bound = Boolean(session?.boundTenant);
  const accountHref = bound ? `${serverEnv().APP_URL}/account/` : "/account/";
  const paymentDue = billingState !== null && PAYMENT_DUE.has(billingState.status);
  const { branding } = ctx.tenant.settings;
  const brand = branding.displayName || ctx.tenant.name;
  // The business's own colours (Settings → Branding) override the platform theme.
  const theme = tenantTheme(branding);
  const { timezone, locale } = ctx.tenant.settings;
  return (
    <>
      {theme.vars ? <style>{themeCss("html:root", theme.vars)}</style> : null}
      <AppShell
        title={brand}
        logoUrl={branding.logoUrl || undefined}
        sidebarStyle={theme.sidebar}
        collapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "1"}
        subtitle={ctx.membership.kind === "client" ? undefined : ctx.membership.title || undefined}
        nav={navFor(ctx)}
        user={ctx.user}
        tenants={tenants
          .filter((tn) => !bound || tn.slug === slug)
          .map((tn) => ({ slug: tn.slug, name: tn.name, current: tn.slug === slug }))}
        isPlatformAdmin={ctx.isPlatformAdmin}
        accountHref={accountHref}
        notifications={
          <NotificationBell
            unread={unread}
            markRead={markNotificationsReadAction.bind(null, slug)}
            items={notes.map((n) => ({
              id: n.id,
              title: n.title,
              body: n.body,
              link: n.link,
              read: n.readAt !== null,
              when: formatDateTime(n.createdAt, timezone, locale),
            }))}
          />
        }
      >
        {paymentDue ? (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{t("billing.pastDueBanner")}</span>
              {hasPermission(ctx, "billing.manage") ? (
                <ButtonLink href={tenantHref(slug, "settings/billing")} size="sm" variant="outline">
                  {t("account.fixPayment")}
                </ButtonLink>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {children}
      </AppShell>
    </>
  );
}
