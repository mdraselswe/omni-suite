import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/i18n";
import { appHref } from "@/lib/href";
import {
  pageChanges,
  pageInfo,
  pageItems,
  queryWith,
  type PageRequest,
  type SearchParams,
} from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { AutoSubmitSelect } from "./page-size-select";

const control = "h-8 rounded-md border border-input bg-card px-2 text-sm dark:bg-input/30";

/**
 * Pager under a list: "Showing 51–100 of 1,234", previous/next, page numbers and rows
 * per page. Every control is a link or a GET form, so it works without JavaScript.
 * Small screens get "Page 2 of 25" instead of the numbers.
 */
export function Pagination({
  path,
  searchParams,
  request,
  paged,
  locale,
  label,
  className,
}: {
  /** The list's own path, e.g. tenantHref(tenant, "clients"). */
  path: string;
  searchParams: SearchParams;
  request: PageRequest;
  paged: { page: number; size: number; total: number };
  locale: string;
  /** Name of the pager landmark when a page has more than one list. */
  label?: string;
  className?: string;
}) {
  const info = pageInfo(paged);
  if (info.total === 0) return null;
  const n = new Intl.NumberFormat(locale);
  const href = (page: number) => appHref(`${path}${queryWith(searchParams, pageChanges(request, page))}`);
  const hasPrev = info.page > 1;
  const hasNext = info.page < info.pageCount;
  const showSizes = info.total > Math.min(...request.sizes);
  const keepFields = Object.entries(searchParams).flatMap(([key, value]) =>
    key === request.keys.page || key === request.keys.size
      ? []
      : (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((v, i) => (
          <input key={`${key}-${i}`} type="hidden" name={key} value={v} />
        )),
  );

  return (
    <nav
      aria-label={label ? t("list.paginationOf", { list: label }) : t("list.pagination")}
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm", className)}
    >
      <p className="text-muted-foreground tabular-nums">
        {t("list.showing", { from: n.format(info.from), to: n.format(info.to), total: n.format(info.total) })}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {info.pageCount > 1 ? (
          <ul className="flex items-center gap-1">
            <li>
              <Step href={hasPrev ? href(info.page - 1) : null} label={t("list.previousPage")}>
                <ChevronLeft aria-hidden="true" />
                <span className="hidden sm:inline">{t("list.previous")}</span>
              </Step>
            </li>
            {pageItems(info.page, info.pageCount).map((item, i) =>
              item === "gap" ? (
                <li
                  key={`gap-${i}`}
                  className="hidden px-1 text-muted-foreground sm:block"
                  aria-hidden="true"
                >
                  …
                </li>
              ) : (
                <li key={item} className="hidden sm:block">
                  <Link
                    href={href(item)}
                    prefetch={false}
                    aria-current={item === info.page ? "page" : undefined}
                    aria-label={
                      item === info.page
                        ? t("list.currentPage", { page: n.format(item) })
                        : t("list.goToPage", { page: n.format(item) })
                    }
                    className={cn(
                      buttonVariants({ variant: item === info.page ? "default" : "ghost", size: "sm" }),
                      "min-w-8 px-2 tabular-nums",
                    )}
                  >
                    {n.format(item)}
                  </Link>
                </li>
              ),
            )}
            <li className="px-2 text-muted-foreground tabular-nums sm:hidden">
              {t("list.pageOf", { page: n.format(info.page), count: n.format(info.pageCount) })}
            </li>
            <li>
              <Step href={hasNext ? href(info.page + 1) : null} label={t("list.nextPage")}>
                <span className="hidden sm:inline">{t("list.next")}</span>
                <ChevronRight aria-hidden="true" />
              </Step>
            </li>
          </ul>
        ) : null}
        {showSizes ? (
          <form method="get" className="flex items-center gap-2">
            {keepFields}
            <label className="flex items-center gap-2 text-muted-foreground">
              <span className="whitespace-nowrap">{t("list.perPage")}</span>
              <AutoSubmitSelect name={request.keys.size} defaultValue={String(info.size)} className={control}>
                {request.sizes.map((s) => (
                  <option key={s} value={s}>
                    {n.format(s)}
                  </option>
                ))}
              </AutoSubmitSelect>
            </label>
            <noscript>
              <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("list.apply")}
              </button>
            </noscript>
          </form>
        ) : null}
      </div>
    </nav>
  );
}

/** Previous/next: a link, or (first/last page) a dimmed look that screen readers skip. */
function Step({
  href,
  label,
  children,
}: {
  href: ReturnType<typeof appHref> | null;
  label: string;
  children: ReactNode;
}) {
  const look = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1");
  return href ? (
    <Link href={href} prefetch={false} aria-label={label} className={look}>
      {children}
    </Link>
  ) : (
    // Muted text, not opacity: dimmed but still readable (colour contrast stays AA).
    <span aria-hidden="true" className={cn(look, "pointer-events-none text-muted-foreground shadow-none")}>
      {children}
    </span>
  );
}
