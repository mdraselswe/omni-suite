import { t } from "@/i18n";

/** Shaped like the bills list: amounts owed, filters, then rows. */
export default function Loading() {
  return (
    <div role="status" aria-label={t("loading.label")} className="grid gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="grid gap-2 surface p-5">
            <span className="shimmer h-4 w-24 rounded bg-foreground/8" />
            <span className="shimmer h-6 w-32 rounded-md bg-foreground/8" />
            <span className="shimmer h-3 w-40 rounded bg-foreground/8" />
          </div>
        ))}
      </div>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span className="shimmer h-6 w-28 rounded-md bg-foreground/8" />
          <span className="shimmer h-9 w-28 rounded-md bg-foreground/8" />
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="shimmer h-9 w-36 rounded-md bg-muted" />
          <span className="shimmer h-9 w-56 rounded-md bg-muted" />
        </div>
        <div className="grid gap-3 surface p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="grid gap-1.5">
                <span className="shimmer h-4 w-40 rounded bg-muted" />
                <span className="shimmer h-3 w-24 rounded bg-muted" />
              </span>
              <span className="shimmer h-4 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
