import { customFieldName, type CustomFieldDef, type CustomValues } from "@/lib/custom-fields";
import { CheckboxField, SelectField, TextField } from "./field";

/** Inputs for a tenant's custom fields (ADR 0009). */
export function CustomFieldInputs({
  defs,
  values = {},
}: {
  defs: readonly CustomFieldDef[];
  values?: CustomValues;
}) {
  return defs.map((def) => {
    const name = customFieldName(def.key);
    const value = values[def.key];
    if (def.type === "checkbox")
      return <CheckboxField key={def.key} name={name} label={def.label} defaultChecked={value === true} />;
    if (def.type === "select") {
      return (
        <SelectField
          key={def.key}
          name={name}
          label={def.label}
          options={def.options.map((o) => ({ value: o, label: o }))}
          placeholder={def.required ? undefined : "—"}
          defaultValue={typeof value === "string" ? value : ""}
        />
      );
    }
    return (
      <TextField
        key={def.key}
        name={name}
        label={def.label}
        type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
        required={def.required}
        defaultValue={value === undefined ? "" : String(value)}
      />
    );
  });
}

/** Read-only list of custom values. */
export function CustomFieldValues({
  defs,
  values,
}: {
  defs: readonly CustomFieldDef[];
  values: CustomValues;
}) {
  const shown = defs.filter((d) => values[d.key] !== undefined && values[d.key] !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      {shown.map((d) => (
        <div key={d.key}>
          <dt className="text-muted-foreground">{d.label}</dt>
          <dd>{typeof values[d.key] === "boolean" ? (values[d.key] ? "✓" : "—") : String(values[d.key])}</dd>
        </div>
      ))}
    </dl>
  );
}
