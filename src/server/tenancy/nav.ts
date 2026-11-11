import "server-only";
import type { ShellNavItem } from "@/components/layout/sidebar-nav";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { MODULES, NAV_GROUPS } from "@/modules/catalog";
import type { TenantContext } from "./context";
import { isModuleEnabled } from "./context";

/** Navigation for this member: their area, enabled modules, permissions they hold; ordered by section. */
export function navFor(ctx: TenantContext): ShellNavItem[] {
  const area = ctx.membership.kind === "client" ? "portal" : "team";
  return MODULES.filter((m) => !m.optional || isModuleEnabled(ctx, m.key))
    .flatMap((m) => m.nav.filter((item) => item.area === area && ctx.permissions.has(item.permission)))
    .toSorted((a, b) => NAV_GROUPS.indexOf(a.group) - NAV_GROUPS.indexOf(b.group))
    .map((item) => ({
      href: tenantHref(ctx.tenant.slug, item.path),
      label: t(item.label),
      icon: item.icon,
      exact: item.path === "" || item.path === "portal",
      group: t(`nav.group.${item.group}`),
    }));
}
