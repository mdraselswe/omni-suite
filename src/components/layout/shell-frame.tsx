"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { createContext, use, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { SidebarStyle } from "@/config";
import { t } from "@/i18n";
import { SIDEBAR_COOKIE } from "@/lib/shell";

const ShellContext = createContext<{ collapsed: boolean; toggle: () => void; sidebarStyle: SidebarStyle }>({
  collapsed: false,
  toggle: () => {},
  sidebarStyle: "light",
});

/** Holds the collapsed/expanded sidebar state for the signed-in layout. */
export function ShellFrame({
  initialCollapsed,
  sidebarStyle,
  children,
}: {
  initialCollapsed: boolean;
  sidebarStyle: SidebarStyle;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <ShellContext value={{ collapsed, toggle, sidebarStyle }}>
      <div
        data-sidebar={sidebarStyle}
        data-collapsed={collapsed ? "true" : "false"}
        className="group/shell flex min-h-svh"
      >
        {children}
      </div>
    </ShellContext>
  );
}

export function useShell() {
  return use(ShellContext);
}

/** Header button that collapses the desktop sidebar to icons. */
export function SidebarToggle() {
  const { collapsed, toggle } = useShell();
  const label = collapsed ? t("shell.expand") : t("shell.collapse");
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={collapsed}
      className="hidden header-control rounded-full md:inline-flex"
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
