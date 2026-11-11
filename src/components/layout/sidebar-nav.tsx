"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { IconName } from "@/modules/catalog";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";

export type ShellNavItem = { href: Route; label: string; icon: IconName; exact: boolean };

/** Side navigation with the current page highlighted. */
export function SidebarNav({
  items,
  onNavigate,
}: {
  items: readonly ShellNavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname().replace(/\/$/, "");
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {items.map((item) => {
        const href = item.href.replace(/\/$/, "");
        const active = item.exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active && "bg-accent font-medium text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
