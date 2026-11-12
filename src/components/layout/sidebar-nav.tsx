"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { IconName } from "@/modules/catalog";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";
import { useShell } from "./shell-frame";

export type ShellNavItem = { href: Route; label: string; icon: IconName; exact: boolean; group: string };

/** Side navigation in sections, current page highlighted. Collapses to icons on desktop. */
export function SidebarNav({
  items,
  onNavigate,
  collapsible = true,
}: {
  items: readonly ShellNavItem[];
  onNavigate?: () => void;
  /** false in the mobile menu, which is always full width. */
  collapsible?: boolean;
}) {
  const pathname = usePathname().replace(/\/$/, "");
  const collapsed = useShell().collapsed && collapsible;
  const groups = items.reduce<{ label: string; items: ShellNavItem[] }[]>((acc, item) => {
    const last = acc.at(-1);
    if (last && last.label === item.group) last.items.push(item);
    else acc.push({ label: item.group, items: [item] });
    return acc;
  }, []);

  return (
    <nav aria-label="Main" className="grid gap-4">
      {groups.map((group) => (
        <div key={group.label} className="grid gap-0.5">
          {collapsed ? (
            <span className="mx-auto mb-1 h-px w-6 bg-sidebar-border" aria-hidden="true" />
          ) : (
            <p className="px-6 pb-1 text-[0.7rem] font-medium tracking-wider text-sidebar-muted uppercase">
              {group.label}
            </p>
          )}
          <ul className="grid gap-0.5">
            {group.items.map((item) => {
              const href = item.href.replace(/\/$/, "");
              const active = item.exact
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);
              const Icon = NAV_ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group/nav relative flex h-10 items-center gap-3 text-sm text-sidebar-foreground transition-colors duration-200 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      collapsed ? "mx-auto w-10 justify-center rounded-xl" : "mr-4 rounded-r-full pl-6",
                      active &&
                        "bg-sidebar-primary font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
                    )}
                  >
                    {active && !collapsed ? (
                      <span
                        className="absolute inset-y-2 left-0 w-1 animate-grow-y rounded-r-full bg-sidebar-primary-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                    <Icon
                      className="size-[1.1rem] shrink-0 transition-transform duration-200 group-hover/nav:scale-115"
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "truncate transition-transform duration-200 group-hover/nav:translate-x-0.5",
                        collapsed && "sr-only",
                      )}
                    >
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
