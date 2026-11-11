import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FieldError } from "./action-form";

type Common = {
  name: string;
  label: string;
  hint?: string;
  className?: string;
};

/** Label + control + hint + error, with the accessible wiring done once. */
export function Field({ name, label, hint, className, children }: Common & { children: ReactNode }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError name={name} />
    </div>
  );
}

export function TextField({
  name,
  label,
  hint,
  className,
  ...input
}: Common & Omit<React.ComponentProps<"input">, "name">) {
  return (
    <Field name={name} label={label} hint={hint} className={className}>
      <Input
        id={name}
        name={name}
        aria-describedby={[hint ? `${name}-hint` : "", `${name}-error`].filter(Boolean).join(" ")}
        {...input}
      />
    </Field>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  className,
  ...input
}: Common & Omit<React.ComponentProps<"textarea">, "name">) {
  return (
    <Field name={name} label={label} hint={hint} className={className}>
      <Textarea id={name} name={name} aria-describedby={`${name}-error`} {...input} />
    </Field>
  );
}

/** Native select: fast, accessible and works without JavaScript. */
export function SelectField({
  name,
  label,
  hint,
  className,
  options,
  placeholder,
  ...select
}: Common & {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
} & Omit<React.ComponentProps<"select">, "name">) {
  return (
    <Field name={name} label={label} hint={hint} className={className}>
      <select
        id={name}
        name={name}
        aria-describedby={`${name}-error`}
        className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
        {...select}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  className,
  defaultChecked,
}: Common & { defaultChecked?: boolean }) {
  return (
    <div className={cn("grid gap-1", className)}>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          className="size-4 rounded border-input accent-primary"
        />
        {label}
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError name={name} />
    </div>
  );
}
