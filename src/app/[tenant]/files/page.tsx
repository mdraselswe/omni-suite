import { FilterBar, FilterSelect, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { ActionButton } from "@/components/form/action-button";
import { CheckboxField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, PageHeader, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  deleteFileAction,
  FileTargetFields,
  formatBytes,
  listFiles,
  toggleFileAction,
  uploadFileAction,
  type FileEntity,
} from "@/features/files";
import { t } from "@/i18n";
import { appHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions, projectOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

const ENTITIES: readonly FileEntity[] = ["general", "client", "project", "transaction"];

export default async function FilesPage({ params, searchParams }: PageProps<"/[tenant]/files">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, scope } = await requireTenantPermission(tenant, "files.read");
  const f = formatters(ctx);
  const entityType = ENTITIES.find((e) => e === param(sp, "type"));
  const canWrite = hasPermission(ctx, "files.write");
  const database = db();
  const [files, clients, projects] = await Promise.all([
    listFiles(database, ctx, scope, { entityType }),
    clientOptions(database, ctx.tenant.id),
    projectOptions(database, ctx.tenant.id),
  ]);
  const names = new Map([...clients, ...projects].map((o) => [o.value, o.label]));

  return (
    <div className="grid gap-8">
      <PageHeader
        title={t("files.title")}
        description={t("files.sub")}
        actions={
          canWrite ? (
            <FormDialog
              trigger={t("files.upload")}
              title={t("files.upload")}
              action={uploadFileAction.bind(null, tenant)}
            >
              <TextField name="file" label={t("files.file")} type="file" required />
              <FileTargetFields clients={clients} projects={projects} />
              <CheckboxField name="clientVisible" label={t("files.clientVisible")} />
            </FormDialog>
          ) : null
        }
      />
      <Section title={t("files.title")}>
        <FilterBar>
          <FilterSelect
            name="type"
            label={t("files.attachTo")}
            value={entityType}
            options={ENTITIES.map((e) => ({ value: e, label: t(`files.entity.${e}`) }))}
          />
        </FilterBar>
        {files.length === 0 ? (
          <EmptyState title={t("files.none")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("files.file")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("files.attachTo")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("files.uploadedBy")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t("files.size")}</TableHead>
                {canWrite ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map(({ file, uploaderName }) => (
                <TableRow key={file.id}>
                  <TableCell>
                    <div className="grid gap-0.5">
                      <a
                        href={appHref(`/api/t/${tenant}/files/${file.id}/`)}
                        className="font-medium break-all hover:underline"
                      >
                        {file.name}
                      </a>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{f.date(file.createdAt.toISOString().slice(0, 10))}</span>
                        {file.clientVisible ? <Badge variant="outline">{t("files.shared")}</Badge> : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t(`files.entity.${file.entityType}`)}
                    {file.entityId && names.get(file.entityId) ? `: ${names.get(file.entityId)}` : ""}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{uploaderName ?? ""}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatBytes(file.size)}
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {file.entityType !== "general" ? (
                          <ActionButton
                            action={toggleFileAction.bind(null, tenant)}
                            values={{ id: file.id, visible: file.clientVisible ? "false" : "true" }}
                            variant="ghost"
                          >
                            {file.clientVisible ? t("files.unshare") : t("files.share")}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          action={deleteFileAction.bind(null, tenant)}
                          values={{ id: file.id }}
                          confirm={t("form.confirm")}
                          variant="ghost"
                        >
                          {t("form.delete")}
                        </ActionButton>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
