import Link from "next/link";
import { FilterBar, FilterSearch, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { CustomFieldInputs } from "@/components/form/custom-field-inputs";
import { Field, TextAreaField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClientAction, importClientsAction, listClients } from "@/features/clients";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { customFieldsFor } from "@/server/shared";
import { hasPermission } from "@/server/tenancy/context";

const PAGE = 50;

export default async function ClientsPage({ params, searchParams }: PageProps<"/[tenant]/clients">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, scope } = await requireTenantPermission(tenant, "clients.read");
  const f = formatters(ctx);
  const q = param(sp, "q") || undefined;
  const statusParam = param(sp, "status");
  const status = statusParam === "active" || statusParam === "inactive" ? statusParam : undefined;
  const limit = Math.min(Number(param(sp, "limit")) || PAGE, 1000);
  const canWrite = hasPermission(ctx, "clients.write");
  const database = db();
  const [loaded, defs] = await Promise.all([
    listClients(database, ctx, scope, { q, status, limit: limit + 1 }),
    customFieldsFor(database, ctx.tenant.id, "client"),
  ]);
  const hasMore = loaded.length > limit;
  const rows = loaded.slice(0, limit);
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ q, status })) if (v) next.set(k, v);
  next.set("limit", String(limit + PAGE));

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
      <FilterBar>
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
        <EmptyState title={t("clients.none")} body={t("clients.noneBody")} />
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
      {hasMore ? (
        <ButtonLink
          href={tenantHref(tenant, `clients?${next.toString()}`)}
          variant="outline"
          className="justify-self-center"
        >
          {t("list.loadMore")}
        </ButtonLink>
      ) : null}
    </Section>
  );
}
