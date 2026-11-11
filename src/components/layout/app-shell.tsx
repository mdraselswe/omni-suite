import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { SidebarStyle } from "@/config";
import { BrandMark } from "./brand-mark";
import { CommandMenu } from "./command-menu";
import { MobileNav } from "./mobile-nav";
import { ShellFrame, SidebarToggle } from "./shell-frame";
import { SidebarNav, type ShellNavItem } from "./sidebar-nav";
import { UserMenu, type MenuTenant } from "./user-menu";

/** Signed-in layout: sectioned sidebar (collapsible) on desktop, sheet menu on mobile, header with search. */
export function AppShell({
  title,
  subtitle,
  logoUrl,
  nav,
  user,
  tenants,
  isPlatformAdmin,
  notifications,
  sidebarStyle,
  collapsed,
  children,
}: {
  title: string;
  subtitle?: string;
  logoUrl?: string;
  nav: readonly ShellNavItem[];
  user: { name: string; email: string; image: string | null };
  tenants: readonly MenuTenant[];
  isPlatformAdmin: boolean;
  /** Optional header slot (the notification bell). */
  notifications?: ReactNode;
  sidebarStyle: SidebarStyle;
  collapsed: boolean;
  children: ReactNode;
}) {
  const brand = (
    <div className="flex h-20 shrink-0 items-center gap-3 px-5 group-data-[collapsed=true]/shell:justify-center group-data-[collapsed=true]/shell:px-0">
      <BrandMark name={title} logoUrl={logoUrl} />
      <div className="grid min-w-0 group-data-[collapsed=true]/shell:sr-only">
        <p className="truncate font-heading text-base font-semibold">{title}</p>
        {subtitle ? <p className="truncate text-xs text-sidebar-muted">{subtitle}</p> : null}
      </div>
    </div>
  );

  return (
    <ShellFrame initialCollapsed={collapsed} sidebarStyle={sidebarStyle}>
      <aside className="sticky top-0 z-40 hidden h-svh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground shadow-[var(--sidebar-shadow)] group-data-[collapsed=true]/shell:w-20 md:flex print:hidden">
        {brand}
        <div className="flex-1 overflow-y-auto pt-2 pb-6">
          <SidebarNav items={nav} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 bg-background/85 px-4 backdrop-blur-md sm:gap-3 md:h-20 md:px-8 print:hidden">
          <MobileNav items={nav} brand={brand} />
          <SidebarToggle />
          <CommandMenu items={nav} />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {notifications}
            <ThemeToggle />
            <UserMenu user={user} tenants={tenants} isPlatformAdmin={isPlatformAdmin} />
          </div>
        </header>
        <main id="content" className="flex-1 px-4 pt-2 pb-10 md:px-8 print:p-0">
          {children}
        </main>
      </div>
    </ShellFrame>
  );
}
