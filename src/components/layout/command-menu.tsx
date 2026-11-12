"use client";

import { CornerDownLeft, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";
import type { ShellNavItem } from "./sidebar-nav";

/** "Search pages" pill in the header; also opens with Ctrl/⌘ + K. Enter goes to the first match. */
export function CommandMenu({ items }: { items: readonly ShellNavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q ? items.filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(q)) : items;
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("shell.search")}
        className="flex size-10 header-control items-center gap-3 rounded-full text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:justify-center sm:h-10 sm:w-72 sm:px-4"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left max-sm:sr-only">{t("shell.search")}</span>
        <kbd className="rounded-md border px-1.5 text-[0.7rem] font-medium max-sm:hidden">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogTitle className="sr-only">{t("shell.search")}</DialogTitle>
          <form
            className="flex items-center gap-3 border-b px-4"
            onSubmit={(event) => {
              event.preventDefault();
              const first = matches[0];
              if (first) {
                router.push(first.href);
                close();
              }
            }}
          >
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("shell.searchPlaceholder")}
              aria-label={t("shell.search")}
              className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </form>
          {matches.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("shell.noResults")}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto p-2">
              {matches.map((item, index) => {
                const Icon = NAV_ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={close}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                        index === 0 && q && "bg-accent text-accent-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.group}</span>
                      {index === 0 && q ? <CornerDownLeft className="size-3.5" aria-hidden="true" /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
