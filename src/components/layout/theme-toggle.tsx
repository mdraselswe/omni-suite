"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { t } from "@/i18n";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const { mode, cycle } = useTheme();
  const Icon = ICONS[mode];
  const label = t(`theme.${mode}`);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="group/theme size-10 header-control rounded-full"
    >
      <Icon
        key={mode}
        className="animate-spin-in transition-transform duration-300 group-hover/theme:rotate-12"
        aria-hidden="true"
      />
    </Button>
  );
}
