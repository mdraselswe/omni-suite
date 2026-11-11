"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Tabs-style links between the pages of one module. */
export function SubNav({ items }: { items: readonly { href: Route; label: string; exact?: boolean }[] }) {
  const pathname = usePathname().replace(/\/$/, "");
  return (
    <nav
      aria-label="Section"
      className="mb-6 flex w-fit max-w-full [scrollbar-width:none] gap-1 overflow-x-auto surface p-1"
    >
      {items.map((item) => {
        const href = item.href.replace(/\/$/, "");
        const active = item.exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-[calc(var(--radius)-0.25rem)] px-4 py-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
              active &&
                "bg-primary font-medium text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
