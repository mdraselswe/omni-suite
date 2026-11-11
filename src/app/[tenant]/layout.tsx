import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationBell } from "@/components/layout/notification-bell";
import { markNotificationsReadAction } from "@/features/settings";
import { formatDateTime } from "@/lib/dates";
import { SIDEBAR_COOKIE } from "@/lib/shell";
import { tenantTheme, themeCss } from "@/lib/theme";
import { db } from "@/server/db";
import { requireTenant } from "@/server/auth/session";
import { listNotifications, unreadCount } from "@/server/shared";
import { navFor } from "@/server/tenancy/nav";
import { userTenants } from "@/server/tenancy/service";

export default async function TenantLayout({ children, params }: LayoutProps<"/[tenant]">) {
  const { tenant: slug } = await params;
  const ctx = await requireTenant(slug);
  const database = db();
  const [tenants, notes, unread, cookieStore] = await Promise.all([
    userTenants(database, ctx.user.id),
    listNotifications(database, ctx.tenant.id, ctx.user.id, 15),
    unreadCount(database, ctx.tenant.id, ctx.user.id),
    cookies(),
  ]);
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
        tenants={tenants.map((tn) => ({ slug: tn.slug, name: tn.name, current: tn.slug === slug }))}
        isPlatformAdmin={ctx.isPlatformAdmin}
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
        {children}
      </AppShell>
    </>
  );
}
