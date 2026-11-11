import { ActionButton } from "@/components/form/action-button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addCustomFieldAction, deleteCustomFieldAction, listCustomFields } from "@/features/settings";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

const ENTITIES = ["client", "lead", "project", "invoice"] as const;
const TYPES = ["text", "number", "date", "select", "checkbox"] as const;

export default async function CustomFieldsPage({ params }: PageProps<"/[tenant]/settings/fields">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  const fields = await listCustomFields(db(), ctx.tenant.id);

  return (
    <Section
      title={t("settings.customFields")}
      description={t("settings.customFieldsSub")}
      actions={
        <FormDialog
          trigger={t("settings.addField")}
          title={t("settings.addField")}
          action={addCustomFieldAction.bind(null, tenant)}
        >
          <SelectField
            name="entity"
            label={t("settings.entity")}
            options={ENTITIES.map((e) => ({ value: e, label: t(`settings.entity.${e}`) }))}
          />
          <TextField name="label" label={t("settings.fieldLabel")} required />
          <SelectField
            name="type"
            label={t("settings.fieldType")}
            options={TYPES.map((ty) => ({ value: ty, label: t(`settings.type.${ty}`) }))}
          />
          <TextAreaField name="options" label={t("settings.options")} rows={4} />
          <CheckboxField name="required" label={t("settings.required")} />
        </FormDialog>
      }
    >
      {fields.length === 0 ? (
        <EmptyState title={t("settings.noFields")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.fieldLabel")}</TableHead>
              <TableHead>{t("settings.entity")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("settings.fieldType")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => (
              <TableRow key={field.id}>
                <TableCell>
                  <div className="grid gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {field.label}
                      {field.required ? <Badge variant="outline">{t("settings.required")}</Badge> : null}
                    </span>
                    {field.options.length > 0 ? (
                      <span className="text-xs text-muted-foreground">{field.options.join(", ")}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{t(`settings.entity.${field.entity}`)}</TableCell>
                <TableCell className="hidden sm:table-cell">{t(`settings.type.${field.type}`)}</TableCell>
                <TableCell>
                  <ActionButton
                    action={deleteCustomFieldAction.bind(null, tenant)}
                    values={{ id: field.id }}
                    confirm={t("form.confirm")}
                    variant="ghost"
                  >
                    {t("form.delete")}
                  </ActionButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
