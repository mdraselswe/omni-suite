import Link from "next/link";
import { FilterBar, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/data/status-badge";
import { CustomFieldInputs } from "@/components/form/custom-field-inputs";
import { Field, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClientAction, importClientsAction, pageClients } from "@/features/clients";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { customFieldsFor } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";

export default async function ClientsPage({ params, searchParams }: PageProps<"/[tenant]/clients">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, scope } = await requireTenantPermission(tenant, "clients.read");
  const f = formatters(ctx);
  const q = normaliseSearch(param(sp, "q"));
  const statusParam = param(sp, "status");
  const status = statusParam === "active" || statusParam === "inactive" ? statusParam : undefined;
  const page = parsePage(sp);
  const path = tenantHref(tenant, "clients");
  const canWrite = hasPermission(ctx, "clients.write");
  const database = db();
  const [found, defs] = await Promise.all([
    pageClients(database, ctx, scope, { q, status }, page),
    customFieldsFor(database, ctx.tenant.id, "client"),
  ]);
  const rows = found.rows;

  return (
    <Section
      title={t("clients.title")}
      actions={
        canWrite ? (
          <div className="flex flex-wrap gap-2">
            <FormDialog
              trigger={t("clients.import")}
              title={t("clients.import")}
              description={t("clients.importHintCustom")}
              action={importClientsAction.bind(null, tenant)}
              submitLabel={t("clients.import")}
              variant="outline"
              icon={false}
            >
              <Field name="file" label={t("files.file")}>
                <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
              </Field>
            </FormDialog>
            <FormDialog
              trigger={t("clients.new")}
              title={t("clients.new")}
              action={createClientAction.bind(null, tenant)}
              wide
            >
              <TextField name="name" label={t("clients.name")} required />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="email" label={t("form.email.label")} type="email" />
                <TextField name="phone" label={t("form.phone")} type="tel" />
                <TextField name="contactName" label={t("clients.contactName")} />
                <TextField
                  name="billingEmail"
                  label={t("clients.billingEmail")}
                  hint={t("clients.billingEmailHint")}
                  type="email"
                />
              </div>
              <TextField name="website" label={t("clients.website")} type="url" placeholder="https://" />
              <TextAreaField name="address" label={t("clients.address")} rows={2} />
              <CustomFieldInputs defs={defs} />
              <TextAreaField name="notes" label={t("form.notes")} rows={3} />
            </FormDialog>
          </div>
        ) : null
      }
    >
      <FilterBar keep={keepSize(page)}>
        <FilterSelect
          name="status"
          label={t("form.status")}
          value={status}
          options={[
            { value: "active", label: t("clients.status.active") },
            { value: "inactive", label: t("clients.status.inactive") },
          ]}
        />
        <FilterSearch value={q} />
      </FilterBar>

      {rows.length === 0 ? (
        q ? (
          <NoResults q={q} path={path} searchParams={sp} />
        ) : (
          <EmptyState title={t("clients.none")} body={t("clients.noneBody")} />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("clients.name")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("form.email.label")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("form.status")}</TableHead>
              <TableHead className="text-right">{t("clients.balance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={tenantHref(tenant, `clients/${c.id}`)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{c.email}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge status={c.status} label={t(`clients.status.${c.status}`)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.balanceMinor > 0n ? f.money(c.balanceMinor) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
    </Section>
  );
}
