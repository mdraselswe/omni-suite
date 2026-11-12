import type { ReactNode } from "react";
import { t } from "@/i18n";
import { LiveSearch } from "./live-search";

const control = "h-9 min-w-0 rounded-md border border-input bg-card px-2 text-sm dark:bg-input/30";

/**
 * GET form for list filters: works without JavaScript and keeps filters in the URL.
 * `keep` adds hidden fields (e.g. the page size) so filtering doesn't reset them.
 */
export function FilterBar({
  children,
  keep,
}: {
  children: ReactNode;
  keep?: Record<string, string | undefined>;
}) {
  return (
    <form role="search" className="flex flex-wrap items-end gap-2">
      {Object.entries(keep ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      {children}
      <button type="submit" className="h-9 rounded-md border bg-card px-3 text-sm hover:bg-accent">
        {t("form.filter")}
      </button>
    </form>
  );
}

export function FilterDate({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <input type="date" name={name} defaultValue={value} className={control} />
    </label>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <select name={name} defaultValue={value ?? ""} className={control}>
        <option value="">{t("form.all")}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Search box (`q`): searches as you type with JavaScript, on submit without. */
export function FilterSearch({ value }: { value?: string }) {
  return <LiveSearch label={t("form.search")} value={value ?? ""} className={control} />;
}

/** Reads a string search param. */
export function param(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}
