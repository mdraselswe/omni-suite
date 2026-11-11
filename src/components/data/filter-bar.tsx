import type { ReactNode } from "react";
import { t } from "@/i18n";

const control = "h-9 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30";

/** GET form for list filters: works without JavaScript and keeps filters in the URL. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <form role="search" className="flex flex-wrap items-end gap-2">
      {children}
      <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-accent">
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

export function FilterSearch({ value }: { value?: string }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {t("form.search")}
      <input type="search" name="q" defaultValue={value} className={control} />
    </label>
  );
}

/** Reads a string search param. */
export function param(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}
