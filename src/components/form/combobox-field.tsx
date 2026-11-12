"use client";

import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Field } from "./field";

export type ComboboxOption = { value: string; label: string };

/**
 * A searchable picker for long lists (currencies, time zones). Type to filter,
 * arrow keys to move, Enter to pick. Posts the chosen `value` under `name`
 * through a hidden input, so it works inside ActionForm like any other field.
 * Pass `value` + `onValueChange` to control it, or `defaultValue` to leave it uncontrolled.
 */
export function ComboboxField({
  name,
  label,
  hint,
  className,
  options,
  defaultValue,
  value,
  onValueChange,
  required,
  readOnly,
  disabled,
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  className?: string;
  options: ComboboxOption[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const find = (v: string | undefined): ComboboxOption | null => options.find((o) => o.value === v) ?? null;
  const selection = value === undefined ? { defaultValue: find(defaultValue) } : { value: find(value) };
  const describedBy = [hint ? `${name}-hint` : "", `${name}-error`].filter(Boolean).join(" ");

  return (
    <Field name={name} label={label} hint={hint} className={className}>
      <Combobox.Root<ComboboxOption>
        items={options}
        name={name}
        {...selection}
        onValueChange={(next) => onValueChange?.(next?.value ?? "")}
        isItemEqualToValue={(a, b) => a.value === b.value}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
        autoHighlight
      >
        <Combobox.InputGroup
          className={cn(
            "relative flex h-9 w-full min-w-0 items-center rounded-lg border border-input bg-card transition-colors",
            "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
            "data-readonly:bg-muted/50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
          )}
        >
          <Combobox.Input
            id={name}
            placeholder={placeholder ?? t("picker.search")}
            aria-describedby={describedBy}
            className="h-full w-full min-w-0 truncate rounded-lg bg-transparent pr-9 pl-3 text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
          {readOnly ? null : (
            <Combobox.Trigger
              aria-label={t("picker.open")}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
            >
              <ChevronDownIcon aria-hidden="true" className="size-4" />
            </Combobox.Trigger>
          )}
        </Combobox.InputGroup>

        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="isolate z-50 outline-none">
            <Combobox.Popup
              className={cn(
                "w-(--anchor-width) max-w-(--available-width) min-w-48 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
                "transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none",
              )}
            >
              <Combobox.Empty>
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("picker.empty")}</p>
              </Combobox.Empty>
              <Combobox.List className="max-h-[min(20rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0">
                {(item: ComboboxOption) => (
                  <Combobox.Item
                    key={item.value}
                    value={item}
                    className="relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:font-medium"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <Combobox.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
                      <CheckIcon aria-hidden="true" className="size-4" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </Field>
  );
}
