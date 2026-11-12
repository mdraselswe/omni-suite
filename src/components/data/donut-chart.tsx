import { cn } from "@/lib/utils";

export type DonutSlice = {
  label: string;
  value: number;
  /** The value formatted for people. */
  formatted: string;
};

const COLORS = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3", "stroke-chart-4", "stroke-chart-5"];
const DOTS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Ring chart drawn as SVG on the server: it spins in, and hovering a slice dims
 * the others (transform and opacity only). Up to five slices: pass the largest
 * four and an "Other" total. Screen readers get the legend list.
 */
export function DonutChart({
  slices,
  total,
  totalLabel,
  className,
}: {
  slices: readonly DonutSlice[];
  /** Formatted total shown in the middle. */
  total: string;
  totalLabel: string;
  className?: string;
}) {
  const shown = slices.slice(0, COLORS.length);
  const sum = shown.reduce((a, s) => a + Math.max(0, s.value), 0);
  const shares = shown.map((s) => (sum > 0 ? Math.max(0, s.value) / sum : 0));
  // A small gap between slices, unless there's only one.
  const gap = shown.length > 1 ? 1.2 : 0;
  const arcs = shown.map((s, i) => {
    const share = shares[i] ?? 0;
    const before = shares.slice(0, i).reduce((a, v) => a + v, 0);
    const length = Math.max(0, share * CIRCUMFERENCE - gap);
    return { ...s, i, share, dash: `${length} ${CIRCUMFERENCE - length}`, offset: -before * CIRCUMFERENCE };
  });

  return (
    <div className={cn("grid items-center gap-6 sm:grid-cols-[auto_1fr]", className)}>
      <div className="relative mx-auto size-44" aria-hidden="true">
        <svg
          viewBox="0 0 100 100"
          className="size-full -rotate-90 animate-spin-in [&:has(circle:hover)_circle:not(:hover)]:opacity-35"
        >
          <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="12" className="stroke-muted" />
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              strokeWidth="12"
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              strokeLinecap="butt"
              className={cn(COLORS[a.i], "transition-opacity duration-200")}
            >
              <title>{`${a.label}: ${a.formatted}`}</title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 grid animate-fade place-content-center text-center [animation-delay:500ms]">
          <span className="font-heading text-lg font-medium tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">{totalLabel}</span>
        </div>
      </div>
      <ul className="grid gap-2.5 text-sm">
        {arcs.map((a) => (
          <li
            key={a.label}
            className="flex animate-slide-right items-center gap-3"
            style={{ animationDelay: `${300 + a.i * 70}ms` }}
          >
            <span className={cn("size-2.5 shrink-0 rounded-full", DOTS[a.i])} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            <span className="font-medium tabular-nums">{a.formatted}</span>
            <span className="w-11 text-right text-xs text-muted-foreground tabular-nums">
              {Math.round(a.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
