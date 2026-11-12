import "server-only";
import type { ShellNavItem } from "@/components/layout/sidebar-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { MODULES, NAV_GROUPS } from "@/modules/catalog";
import { aiConfigured } from "@/server/ai";
import type { TenantContext } from "./context";
import { isModuleEnabled } from "./context";

const isHome = (item: { path: string }) => item.path === "" || item.path === "portal";

/** Navigation for this member: their area, enabled modules, permissions they hold; ordered by section. */
export function navFor(ctx: TenantContext): ShellNavItem[] {
  const area = ctx.membership.kind === "client" ? "portal" : "team";
  return (
    MODULES.filter((m) => !m.optional || isModuleEnabled(ctx, m.key))
      .flatMap((m) => m.nav.filter((item) => item.area === area && ctx.permissions.has(item.permission)))
      // The assistant needs an AI provider with a key on this server.
      .filter((item) => item.permission !== "portal.assistant" || aiConfigured("portalAssistant"))
      // By section; the home page leads its section.
      .toSorted(
        (a, b) =>
          NAV_GROUPS.indexOf(a.group) - NAV_GROUPS.indexOf(b.group) || Number(isHome(b)) - Number(isHome(a)),
      )
      .map((item) => ({
        href: tenantHref(ctx.tenant.slug, item.path),
        label: t(item.label),
        icon: item.icon,
        exact: isHome(item),
        group: t(`nav.group.${item.group}`),
      }))
  );
}
