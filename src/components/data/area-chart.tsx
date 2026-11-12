import { areaPath, niceMax, smoothPath, toPoints } from "@/lib/chart";
import { cn } from "@/lib/utils";

const WIDTH = 600;
const HEIGHT = 200;

export type ChartSeries = {
  name: string;
  values: readonly number[];
  /** The same values formatted for people (shown in the screen-reader table). */
  formatted: readonly string[];
  /** Theme chart colour. */
  color: 1 | 2;
};

/**
 * Smooth area chart drawn as SVG on the server. The lines draw in left to right and
 * hovering a month shows its numbers (CSS only, transform and opacity); screen
 * readers get a table with the same numbers.
 */
export function AreaChart({
  id,
  caption,
  labels,
  tableLabels = labels,
  series,
  className,
}: {
  /** Unique on the page (used for SVG gradient ids). */
  id: string;
  caption: string;
  /** Short labels under the chart. */
  labels: readonly string[];
  /** Longer labels for the screen-reader table (defaults to `labels`). */
  tableLabels?: readonly string[];
  series: readonly ChartSeries[];
  className?: string;
}) {
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const plotted = series.map((s) => ({ ...s, points: toPoints(s.values, WIDTH, HEIGHT, top) }));
  const count = labels.length;
  // Hover columns are centred on the points, which run edge to edge.
  const columnWidth = count > 1 ? 100 / (count - 1) : 100;
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
      <div className="relative h-52 sm:h-60" aria-hidden="true">
        <div className="absolute inset-0 grid grid-rows-4">
          {[0, 1, 2, 3].map((row) => (
            <span key={row} className="border-t border-dashed" />
          ))}
        </div>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.name} id={`${id}-fill-${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="0%"
                  className={s.color === 1 ? "[stop-color:var(--chart-1)]" : "[stop-color:var(--chart-2)]"}
                  stopOpacity="0.28"
                />
                <stop
                  offset="100%"
                  className={s.color === 1 ? "[stop-color:var(--chart-1)]" : "[stop-color:var(--chart-2)]"}
                  stopOpacity="0"
                />
              </linearGradient>
            ))}
          </defs>
          {plotted.map((s, i) => (
            <g key={s.name}>
              <path
                d={areaPath(s.points, HEIGHT)}
                fill={`url(#${id}-fill-${i})`}
                className="animate-fade [animation-delay:400ms]"
              />
              <path
                d={smoothPath(s.points, HEIGHT)}
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className={s.color === 1 ? "stroke-chart-1" : "stroke-chart-2"}
              />
            </g>
          ))}
        </svg>
        {/* A card-coloured curtain slides away, so the lines draw in left to right (transform only). */}
        <span className="animate-curtain absolute -inset-1 origin-right bg-card" />
        {/* Hover: a guide line, bigger dots and the month's numbers. */}
        <div className="absolute inset-0">
          {labels.map((label, i) => {
            const highest = Math.min(...plotted.map((s) => s.points[i]?.[1] ?? HEIGHT));
            return (
              <div
                key={`${label}-${i}`}
                className="group/col absolute inset-y-0"
                style={{
                  left: `${count > 1 ? (i / (count - 1)) * 100 : 50}%`,
                  width: `${columnWidth}%`,
                  transform: "translateX(-50%)",
                }}
              >
                <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/15 opacity-0 transition-opacity duration-200 group-hover/col:opacity-100" />
                {plotted.map((s, k) => {
                  const point = s.points[i];
                  if (!point) return null;
                  return (
                    <span
                      key={s.name}
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
                      style={{ top: `${(point[1] / HEIGHT) * 100}%` }}
                    >
                      <span
                        className="block animate-pop"
                        style={{ animationDelay: `${700 + i * 60 + k * 30}ms` }}
                      >
                        <span
                          className={cn(
                            "block size-2.5 rounded-full border-2 bg-card transition-transform duration-200 group-hover/col:scale-150",
                            s.color === 1 ? "border-chart-1" : "border-chart-2",
                          )}
                        />
                      </span>
                    </span>
                  );
                })}
                <div
                  className={cn(
                    "pointer-events-none absolute z-10 grid translate-y-1 gap-1 rounded-lg bg-popover px-3 py-2 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-md ring-1 ring-foreground/10 transition duration-200 group-hover/col:translate-y-0 group-hover/col:opacity-100",
                    i === 0 ? "left-0" : i === count - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
                  )}
                  style={{ bottom: `calc(${100 - (highest / HEIGHT) * 100}% + 0.75rem)` }}
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
      {/* Points run edge to edge, so the labels are spread the same way. */}
      <div className="flex justify-between gap-1 text-[11px] text-muted-foreground" aria-hidden="true">
        {labels.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="w-0 flex-1 truncate text-center first:text-left last:text-right"
          >
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
