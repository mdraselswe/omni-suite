import { ArrowDown, ArrowUp } from "lucide-react";
import { ActionButton } from "@/components/form/action-button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addCustomFieldAction,
  deleteCustomFieldAction,
  listCustomFields,
  moveCustomFieldAction,
  updateCustomFieldAction,
} from "@/features/settings";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

const ENTITIES = ["client", "lead", "project", "invoice"] as const;
const TYPES = ["text", "number", "date", "select", "checkbox"] as const;

export default async function CustomFieldsPage({ params }: PageProps<"/[tenant]/settings/fields">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  const fields = await listCustomFields(db(), ctx.tenant.id);
  // Order is per record type: the first/last field of each type can't move further.
  const siblings = (entity: string) => fields.filter((f) => f.entity === entity);

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
                  <div className="flex items-center justify-end gap-1">
                    {siblings(field.entity)[0]?.id === field.id ? (
                      <span className="size-8" aria-hidden="true" />
                    ) : (
                      <ActionButton
                        action={moveCustomFieldAction.bind(null, tenant)}
                        values={{ id: field.id, direction: "up" }}
                        variant="ghost"
                        size="icon-sm"
                      >
                        <ArrowUp aria-hidden="true" />
                        <span className="sr-only">{t("settings.moveUp", { label: field.label })}</span>
                      </ActionButton>
                    )}
                    {siblings(field.entity).at(-1)?.id === field.id ? (
                      <span className="size-8" aria-hidden="true" />
                    ) : (
                      <ActionButton
                        action={moveCustomFieldAction.bind(null, tenant)}
                        values={{ id: field.id, direction: "down" }}
                        variant="ghost"
                        size="icon-sm"
                      >
                        <ArrowDown aria-hidden="true" />
                        <span className="sr-only">{t("settings.moveDown", { label: field.label })}</span>
                      </ActionButton>
                    )}
                    <FormDialog
                      trigger={t("form.edit")}
                      title={t("settings.editField", { label: field.label })}
                      description={t("settings.editFieldSub")}
                      action={updateCustomFieldAction.bind(null, tenant)}
                      variant="ghost"
                      size="sm"
                      icon={false}
                    >
                      <input type="hidden" name="id" value={field.id} />
                      <TextField
                        name="label"
                        label={t("settings.fieldLabel")}
                        defaultValue={field.label}
                        maxLength={80}
                        required
                      />
                      {field.type === "select" ? (
                        <TextAreaField
                          name="options"
                          label={t("settings.options")}
                          rows={4}
                          defaultValue={field.options.join("\n")}
                        />
                      ) : null}
                      <CheckboxField
                        name="required"
                        label={t("settings.required")}
                        defaultChecked={field.required}
                      />
                    </FormDialog>
                    <ActionButton
                      action={deleteCustomFieldAction.bind(null, tenant)}
                      values={{ id: field.id }}
                      confirm={t("form.confirm")}
                      variant="ghost"
                    >
                      {t("form.delete")}
                    </ActionButton>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
