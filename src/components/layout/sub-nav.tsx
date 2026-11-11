"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Tabs-style links between the pages of one module. */
export function SubNav({ items }: { items: readonly { href: Route; label: string; exact?: boolean }[] }) {
  const pathname = usePathname().replace(/\/$/, "");
  return (
    <nav aria-label="Section" className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b px-1">
      {items.map((item) => {
        const href = item.href.replace(/\/$/, "");
        const active = item.exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
              active && "border-primary font-medium text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
