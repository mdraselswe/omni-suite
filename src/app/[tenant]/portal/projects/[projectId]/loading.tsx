import { t } from "@/i18n";

/** Shaped like the project page: header, overview with progress, task groups, discussion and files. */
export default function Loading() {
  return (
    <div role="status" aria-label={t("loading.label")} className="grid gap-8">
      <div className="grid gap-2">
        <span className="shimmer h-7 w-24 rounded-md bg-foreground/8" />
        <span className="shimmer h-8 w-64 max-w-full rounded-md bg-foreground/8" />
        <span className="shimmer h-4 w-80 max-w-full rounded bg-foreground/8" />
      </div>
      <div className="grid gap-4 surface p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="grid gap-1">
              <span className="shimmer h-3 w-16 rounded bg-muted" />
              <span className="shimmer h-4 w-24 rounded bg-muted" />
            </span>
          ))}
        </div>
        <span className="shimmer h-2 rounded-full bg-muted" />
      </div>
      <div className="grid gap-2">
        <span className="shimmer h-5 w-32 rounded bg-foreground/8" />
        <div className="grid gap-px overflow-hidden surface">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="shimmer m-3 h-5 rounded bg-muted" />
          ))}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="grid content-start gap-3">
            <span className="shimmer h-5 w-28 rounded bg-foreground/8" />
            <span className="shimmer h-20 rounded-md bg-muted" />
            <span className="shimmer h-20 rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
