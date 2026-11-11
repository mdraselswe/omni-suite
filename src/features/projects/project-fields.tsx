import { CustomFieldInputs } from "@/components/form/custom-field-inputs";
import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { t } from "@/i18n";
import type { CustomFieldDef, CustomValues } from "@/lib/custom-fields";

type Option = { value: string; label: string };

/** Fields of the new/edit project form (names match the project actions). */
export function ProjectFields({
  clients,
  statuses,
  customFields,
  templates,
  values,
}: {
  clients: readonly Option[];
  statuses: readonly Option[];
  customFields: readonly CustomFieldDef[];
  templates?: readonly Option[];
  values?: {
    name: string;
    description: string;
    clientId: string | null;
    status: string;
    startDate: string | null;
    dueDate: string | null;
    budget: string;
    custom: CustomValues;
  };
}) {
  return (
    <>
      <TextField name="name" label={t("form.name")} defaultValue={values?.name} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="clientId"
          label={t("projects.client")}
          options={clients}
          placeholder={t("projects.internal")}
          defaultValue={values?.clientId ?? ""}
        />
        <SelectField
          name="status"
          label={t("form.status")}
          options={statuses}
          defaultValue={values?.status}
        />
        <TextField
          name="startDate"
          label={t("projects.start")}
          type="date"
          defaultValue={values?.startDate ?? ""}
        />
        <TextField
          name="dueDate"
          label={t("projects.due")}
          type="date"
          defaultValue={values?.dueDate ?? ""}
        />
        <TextField
          name="budget"
          label={t("projects.budget")}
          inputMode="decimal"
          defaultValue={values?.budget ?? ""}
        />
        {templates && templates.length > 0 ? (
          <SelectField
            name="templateId"
            label={t("projects.template")}
            options={templates}
            placeholder={t("form.none")}
          />
        ) : null}
      </div>
      <TextAreaField
        name="description"
        label={t("form.description")}
        rows={3}
        defaultValue={values?.description}
      />
      <CustomFieldInputs defs={customFields} values={values?.custom} />
    </>
  );
}
