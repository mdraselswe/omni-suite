import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { SubmitButton } from "@/components/form/action-form";
import { Field } from "@/components/form/field";
import { EmptyState, PageHeader, Section } from "@/components/layout/page";
import { ButtonAnchor } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, pageFiles, UploadFileForm } from "@/features/files";
import { listProjects } from "@/features/projects";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";
import { portalPage } from "../_components/portal";
import { UploadTarget } from "../_components/upload-target";

export default async function PortalFiles({ params, searchParams }: PageProps<"/[tenant]/portal/files">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx, clientId } = await portalPage(tenant, "portal.files");
  const f = formatters(ctx);
  const q = normaliseSearch(param(sp, "q"));
  const page = parsePage(sp);
  const path = tenantHref(tenant, "portal/files");
  const database = db();
  const [found, projects] = await Promise.all([
    pageFiles(database, ctx, "all", { q }, page),
    hasPermission(ctx, "portal.projects") ? listProjects(database, ctx, "all") : Promise.resolve([]),
  ]);
  const files = found.rows;
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="grid gap-8">
      <PageHeader title={t("nav.portal.files")} description={t("portal.filesSub")} />

      <Section title={t("portal.uploadTitle")} description={t("portal.uploadHint")}>
        <UploadFileForm tenant={tenant} className="surface p-4 sm:max-w-lg">
          <UploadTarget
            clientId={clientId}
            projects={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Field name="file" label={t("files.file")}>
            <Input id="file" name="file" type="file" required aria-describedby="file-error" />
          </Field>
          <SubmitButton className="justify-self-start">{t("files.upload")}</SubmitButton>
        </UploadFileForm>
      </Section>

      <Section title={t("files.title")}>
        <FilterBar keep={keepSize(page)}>
          <FilterSearch value={q} />
        </FilterBar>
        {files.length === 0 ? (
          q ? (
            <NoResults q={q} path={path} searchParams={sp} />
          ) : (
            <EmptyState title={t("files.none")} />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("files.file")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("portal.project")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("form.date.label")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("files.size")}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map(({ file }) => (
                <TableRow key={file.id}>
                  <TableCell className="max-w-48 truncate sm:max-w-none">{file.name}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {file.entityType === "project" && file.entityId
                      ? (projectName.get(file.entityId) ?? "")
                      : ""}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {f.date(file.createdAt.toISOString().slice(0, 10))}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{formatBytes(file.size)}</TableCell>
                  <TableCell>
                    <ButtonAnchor href={`/api/t/${tenant}/files/${file.id}/`} variant="outline" size="sm">
                      {t("form.download")}
                    </ButtonAnchor>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination path={path} searchParams={sp} request={page} paged={found} locale={f.locale} />
      </Section>
    </div>
  );
}
