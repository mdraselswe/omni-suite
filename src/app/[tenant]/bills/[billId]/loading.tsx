import { t } from "@/i18n";

/** Shaped like a bill: title and actions, the bill's details, then its payments. */
export default function Loading() {
  return (
    <div role="status" aria-label={t("loading.label")} className="mx-auto grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <span className="shimmer h-4 w-16 rounded bg-foreground/8" />
          <span className="shimmer h-8 w-56 rounded-md bg-foreground/8" />
        </div>
        <div className="flex gap-2">
          <span className="shimmer h-9 w-20 rounded-md bg-foreground/8" />
          <span className="shimmer h-9 w-16 rounded-md bg-foreground/8" />
        </div>
      </div>
      <div className="grid gap-6 surface p-4 sm:p-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="grid gap-1.5">
              <span className="shimmer h-3 w-20 rounded bg-muted" />
              <span className="shimmer h-4 w-32 rounded bg-muted" />
            </span>
          ))}
        </div>
        <div className="ml-auto grid w-full max-w-xs gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="shimmer h-4 rounded bg-muted" />
          ))}
        </div>
      </div>
      <div className="grid gap-3">
        <span className="shimmer h-6 w-28 rounded-md bg-foreground/8" />
        <div className="grid gap-3 surface p-5">
          {Array.from({ length: 2 }, (_, i) => (
            <span key={i} className="shimmer h-9 rounded-md bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
