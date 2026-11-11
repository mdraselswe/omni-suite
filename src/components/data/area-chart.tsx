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
 * Smooth area chart drawn as SVG on the server. The line reveals left to right
 * (transform only); screen readers get a table with the same numbers.
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
            <clipPath id={`${id}-reveal`}>
              <rect x="0" y="-10" width={WIDTH} height={HEIGHT + 20} className="animate-grow-x" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-reveal)`}>
            {series.map((s, i) => {
              const points = toPoints(s.values, WIDTH, HEIGHT, top);
              return (
                <g key={s.name}>
                  <path d={areaPath(points, HEIGHT)} fill={`url(#${id}-fill-${i})`} />
                  <path
                    d={smoothPath(points, HEIGHT)}
                    fill="none"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    className={s.color === 1 ? "stroke-chart-1" : "stroke-chart-2"}
                  />
                </g>
              );
            })}
          </g>
        </svg>
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
