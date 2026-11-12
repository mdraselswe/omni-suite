import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page title row with optional description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="grid gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-[1.75rem]">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid content-start gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="font-heading text-lg font-medium">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A titled card: the main building block of dashboards and detail pages. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("grid content-start surface", className)}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-2 px-6 pt-5">
          <div className="grid gap-0.5">
            <h2 className="font-heading text-[1.05rem] font-medium">{title}</h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={cn("p-6", title && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
  bare = false,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  /** Inside a card already: no card of its own. */
  bare?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-2 px-6 text-center",
        bare ? "py-6" : "surface border-dashed py-10",
      )}
    >
      <span className="mb-1 grid size-12 animate-float place-items-center rounded-2xl bg-secondary text-secondary-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="font-medium">{title}</p>
      {body ? <p className="max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

/**
 * A number with a label. `gradient` (1–4) gives the coloured card from the theme;
 * otherwise a white card with a tinted icon.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
  gradient,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
  icon?: LucideIcon;
  gradient?: 1 | 2 | 3 | 4;
}) {
  if (gradient) {
    return (
      <div
        className={cn(
          "group/stat relative flex hover-lift items-center gap-4 overflow-hidden rounded-(--radius) p-5 shadow-surface",
          gradient === 1 && "bg-gradient-1",
          gradient === 2 && "bg-gradient-2",
          gradient === 3 && "bg-gradient-3",
          gradient === 4 && "bg-gradient-4",
        )}
      >
        <span
          className="pointer-events-none absolute -top-8 -right-8 size-28 rounded-full bg-current/10 transition-transform duration-700 ease-out group-hover/stat:scale-150"
          aria-hidden="true"
        />
        {Icon ? (
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-current/15 transition-transform duration-300 group-hover/stat:scale-110 group-hover/stat:-rotate-6">
            <Icon className="size-6" aria-hidden="true" />
          </span>
        ) : null}
        <div className="relative grid min-w-0 gap-0.5">
          <p className="truncate font-heading text-2xl font-medium tabular-nums">{value}</p>
          <p className="truncate text-sm">{label}</p>
          {hint ? <p className="truncate text-xs">{hint}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="group/stat flex hover-lift items-start gap-4 surface p-5">
      {Icon ? (
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground transition-transform duration-300 group-hover/stat:scale-110 group-hover/stat:-rotate-6",
            tone === "positive" && "bg-success/12 text-success",
            tone === "negative" && "bg-destructive/10 text-destructive",
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      <div className="grid min-w-0 gap-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            "font-heading text-xl font-medium tabular-nums",
            tone === "positive" && "text-success",
            tone === "negative" && "text-destructive",
          )}
        >
          {value}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Skeleton for list pages: header + rows, same shape as the real page. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-6">
      <div className="grid gap-2">
        <span className="shimmer h-8 w-48 rounded-md bg-foreground/8" />
        <span className="shimmer h-4 w-72 rounded bg-foreground/8" />
      </div>
      <div className="grid gap-3 surface p-5">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="shimmer h-9 rounded-md bg-muted" />
        ))}
      </div>
    </div>
  );
}
