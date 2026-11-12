"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { lists } from "@/config";
import { t } from "@/i18n";
import { appHref } from "@/lib/href";
import { normaliseSearch } from "@/lib/search";
import { cn } from "@/lib/utils";

/**
 * The search box of a list's filter form. Typing updates `?q=` after a short pause
 * (other filters stay, the list goes back to page 1). Without JavaScript it is a plain
 * field of the GET form, so Enter or the Filter button still search.
 */
export function LiveSearch({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  /** Classes of the input. */
  className?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(value);
  // The server's value last seen, and the search this box last sent.
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The URL changed from elsewhere (clear-search link, back button): show its search.
  // A server answer to this box's own request must not overwrite what is typed since.
  if (value !== seen) {
    setSeen(value);
    if (value !== sent) {
      setText(value);
      setSent(value);
    }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(raw: string) {
    const q = normaliseSearch(raw);
    const params = new URLSearchParams(window.location.search);
    if (q) params.set("q", q);
    else params.delete("q");
    for (const key of [...params.keys()]) if (/page$/.test(key)) params.delete(key);
    const query = params.toString();
    setSent(q);
    startTransition(() => {
      router.replace(appHref(`${window.location.pathname}${query ? `?${query}` : ""}`), { scroll: false });
    });
  }

  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <label className="grid gap-1">
        {label}
        <span className="relative grid">
          <input
            type="search"
            name="q"
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              clearTimeout(timer.current);
              if (normaliseSearch(next) === sent) return;
              timer.current = setTimeout(() => search(next), lists.searchDebounceMs);
            }}
            maxLength={lists.searchMaxLength * 2}
            autoComplete="off"
            enterKeyHint="search"
            className={cn(className, "pr-8")}
          />
          <LoaderCircle
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground transition-opacity motion-safe:animate-spin",
              pending ? "opacity-100" : "opacity-0",
            )}
          />
        </span>
      </label>
      <span role="status" className="sr-only">
        {pending ? t("list.searching") : ""}
      </span>
    </div>
  );
}
