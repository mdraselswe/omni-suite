"use client";

import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { t } from "@/i18n";
import { SidebarNav, type ShellNavItem } from "./sidebar-nav";

export function MobileNav({
  items,
  title,
  footer,
}: {
  items: readonly ShellNavItem[];
  title: string;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" aria-label={t("nav.menu")} />}
      >
        <Menu aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-4 p-4">
        <SheetTitle className="text-base">{title}</SheetTitle>
        <SidebarNav items={items} onNavigate={() => setOpen(false)} />
        {footer}
      </SheetContent>
    </Sheet>
  );
}
