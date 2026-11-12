"use client";

import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { t } from "@/i18n";
import { useShell } from "./shell-frame";
import { SidebarNav, type ShellNavItem } from "./sidebar-nav";

/** Phone and tablet menu: the sidebar in a sheet. */
export function MobileNav({ items, brand }: { items: readonly ShellNavItem[]; brand: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { sidebarStyle } = useShell();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-10 header-control rounded-full md:hidden"
            aria-label={t("nav.menu")}
          />
        }
      >
        <Menu aria-hidden="true" />
      </SheetTrigger>
      <SheetContent
        side="left"
        data-sidebar={sidebarStyle}
        className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
        {brand}
        <div className="overflow-y-auto pt-2 pb-6">
          <SidebarNav items={items} onNavigate={() => setOpen(false)} collapsible={false} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
