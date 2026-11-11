import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { MobileNav } from "./mobile-nav";
import { SidebarNav, type ShellNavItem } from "./sidebar-nav";
import { UserMenu, type MenuTenant } from "./user-menu";

/** Signed-in layout: sidebar on desktop, sheet menu on mobile. */
export function AppShell({
  title,
  subtitle,
  nav,
  user,
  tenants,
  isPlatformAdmin,
  notifications,
  children,
}: {
  title: string;
  subtitle?: string;
  nav: readonly ShellNavItem[];
  user: { name: string; email: string; image: string | null };
  tenants: readonly MenuTenant[];
  isPlatformAdmin: boolean;
  /** Optional header slot (the notification bell). */
  notifications?: ReactNode;
  children: ReactNode;
}) {
  const userMenu = <UserMenu user={user} tenants={tenants} isPlatformAdmin={isPlatformAdmin} />;
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-4 border-r bg-sidebar p-3 md:flex print:hidden">
        <div className="flex items-start gap-1 pt-1 pl-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-base font-semibold">{title}</p>
            {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {notifications}
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav items={nav} />
        </div>
        <div className="flex items-center gap-1 border-t pt-3">
          <div className="min-w-0 flex-1">{userMenu}</div>
          <ThemeToggle />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:hidden print:hidden">
          <MobileNav items={nav} title={title} footer={<div className="border-t pt-3">{userMenu}</div>} />
          <p className="flex-1 truncate font-heading font-semibold">{title}</p>
          {notifications}
          <ThemeToggle />
        </header>
        <main id="content" className="flex-1 px-4 py-6 md:px-8 md:py-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
