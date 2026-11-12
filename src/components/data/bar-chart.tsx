import { niceMax } from "@/lib/chart";
import { cn } from "@/lib/utils";
import type { ChartSeries } from "./area-chart";

/**
 * Grouped bar chart in plain HTML: bars grow up one after another and hovering a
 * group shows its numbers (CSS only, transform and opacity). Screen readers get
 * a table with the same numbers.
 */
export function BarChart({
  caption,
  labels,
  tableLabels = labels,
  series,
  className,
}: {
  caption: string;
  labels: readonly string[];
  tableLabels?: readonly string[];
  series: readonly ChartSeries[];
  className?: string;
}) {
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  return (
    <figure className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", s.color === 1 ? "bg-chart-1" : "bg-chart-2")} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="relative h-56" aria-hidden="true">
        <div className="absolute inset-0 grid grid-rows-4">
          {[0, 1, 2, 3].map((row) => (
            <span key={row} className="border-t border-dashed" />
          ))}
        </div>
        <div className="absolute inset-0 flex items-end gap-1 sm:gap-2">
          {labels.map((label, i) => {
            const highest = Math.max(0, ...series.map((s) => s.values[i] ?? 0));
            return (
              <div
                key={`${label}-${i}`}
                className="group/bar relative flex h-full flex-1 items-end justify-center gap-0.5 sm:gap-1"
              >
                <span className="absolute inset-0 rounded-md bg-foreground/5 opacity-0 transition-opacity duration-200 group-hover/bar:opacity-100" />
                {series.map((s, k) => (
                  <span
                    key={s.name}
                    className={cn(
                      "relative w-full max-w-4 animate-grow-y rounded-t-[3px] transition-opacity duration-200 group-hover/bar:opacity-80",
                      s.color === 1 ? "bg-chart-1" : "bg-chart-2",
                    )}
                    style={{
                      height: `${top > 0 ? (Math.max(0, s.values[i] ?? 0) / top) * 100 : 0}%`,
                      animationDelay: `${i * 50 + k * 25}ms`,
                    }}
                  />
                ))}
                <div
                  className={cn(
                    "pointer-events-none absolute z-10 grid translate-y-1 gap-1 rounded-lg bg-popover px-3 py-2 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-md ring-1 ring-foreground/10 transition duration-200 group-hover/bar:translate-y-0 group-hover/bar:opacity-100",
                    i === 0 ? "left-0" : i === labels.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
                  )}
                  style={{ bottom: `calc(${top > 0 ? (highest / top) * 100 : 0}% + 0.5rem)` }}
                >
                  <span className="font-medium">{tableLabels[i] ?? label}</span>
                  {series.map((s) => (
                    <span key={s.name} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className={cn("size-2 rounded-full", s.color === 1 ? "bg-chart-1" : "bg-chart-2")}
                        />
                        {s.name}
                      </span>
                      <span className="font-medium tabular-nums">{s.formatted[i]}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1 text-[11px] text-muted-foreground sm:gap-2" aria-hidden="true">
        {labels.map((label, i) => (
          <span key={`${label}-${i}`} className="w-0 flex-1 truncate text-center">
            {label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <td />
              {series.map((s) => (
                <th key={s.name} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableLabels.map((label, i) => (
              <tr key={`${label}-${i}`}>
                <th scope="row">{label}</th>
                {series.map((s) => (
                  <td key={s.name}>{s.formatted[i]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
