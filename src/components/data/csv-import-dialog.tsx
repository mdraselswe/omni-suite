"use client";

import { Download, Upload } from "lucide-react";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Field } from "@/components/form/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonAnchor } from "@/components/ui/button-link";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import type { ImportPreview, ImportResult, ImportRowStatus } from "@/lib/csv-import";

type Preview = Extract<ImportPreview, { ok: true }>;
type Done = Extract<ImportResult, { ok: true }>["counts"];

const TONE: Record<ImportRowStatus, "success" | "warning" | "soft" | "destructive"> = {
  ready: "success",
  warning: "warning",
  duplicate: "soft",
  error: "destructive",
};

/**
 * CSV import in two steps: check the file (a preview with every row's status and
 * problems, nothing written), then import the rows that passed. Extra form fields
 * (date format, account…) come in as children and are sent with both steps.
 */
export function CsvImportDialog({
  trigger,
  title,
  description,
  sample,
  columns,
  previewHeaders,
  preview,
  run,
  children,
}: {
  trigger: string;
  title: string;
  description: string;
  /** A downloadable example file (a data: URL) and its name. */
  sample: { href: string; filename: string };
  /** The columns the import understands, for the "expected columns" list. */
  columns: readonly { name: string; hint: string }[];
  /** Headings of the preview's value cells. */
  previewHeaders: readonly string[];
  preview: (formData: FormData) => Promise<ImportPreview>;
  run: (formData: FormData) => Promise<ImportResult>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FormData | null>(null);
  const [checked, setChecked] = useState<Preview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [pending, startTransition] = useTransition();

  function reset() {
    setData(null);
    setChecked(null);
    setDone(null);
    setError(null);
    setProblemsOnly(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      setDone(null);
      const result = await preview(formData).catch(() => ({ ok: false as const, message: t("form.failed") }));
      if (result.ok) {
        setChecked(result);
        setData(formData);
      } else {
        setChecked(null);
        setError(result.message);
      }
    });
  }

  function importRows() {
    if (!data) return;
    startTransition(async () => {
      setError(null);
      const result = await run(data).catch(() => ({ ok: false as const, message: t("form.failed") }));
      if (result.ok) {
        setDone(result.counts);
        setChecked(null);
        toast.success(result.message);
      } else {
        setError(result.message);
      }
    });
  }

  const rows = checked ? checked.rows.filter((r) => !problemsOnly || r.status !== "ready") : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Upload aria-hidden="true" />
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("imports.columns")}</summary>
          <dl className="mt-3 grid gap-2">
            {columns.map((c) => (
              <div key={c.name} className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
                <dt className="font-mono text-xs break-words">{c.name}</dt>
                <dd className="text-muted-foreground">{c.hint}</dd>
              </div>
            ))}
          </dl>
          <ButtonAnchor
            href={sample.href}
            download={sample.filename}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            <Download aria-hidden="true" />
            {t("imports.sample")}
          </ButtonAnchor>
        </details>

        {done ? (
          <div className="grid gap-3" aria-live="polite">
            <p className="font-medium">{t("imports.doneTitle")}</p>
            <ul className="grid gap-1 text-sm">
              <li>{t("imports.result.imported", { count: done.imported })}</li>
              <li className="text-muted-foreground">
                {t("imports.result.duplicates", { count: done.duplicates })}
              </li>
              <li className={done.failed > 0 ? "text-destructive" : "text-muted-foreground"}>
                {t("imports.result.failed", { count: done.failed })}
              </li>
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                {t("imports.another")}
              </Button>
              <DialogClose render={<Button />}>{t("imports.close")}</DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <>
            <form
              onSubmit={check}
              // A new file or option makes the last check stale.
              onChange={() => {
                setChecked(null);
                setData(null);
              }}
              className="grid gap-4"
              noValidate
            >
              <Field name="file" label={t("files.file")}>
                <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
              </Field>
              {children}
              <Button
                type="submit"
                variant={checked ? "outline" : "default"}
                disabled={pending}
                aria-busy={pending}
              >
                {pending && !checked ? t("imports.checking") : t("imports.check")}
              </Button>
            </form>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {checked ? (
              <section className="grid gap-3" aria-labelledby="import-preview-title">
                <h3 id="import-preview-title" className="font-medium">
                  {t("imports.previewTitle")}
                </h3>
                <ul className="grid gap-1 text-sm" aria-live="polite">
                  <li>{t("imports.preview.ready", { count: checked.counts.ready })}</li>
                  <li className="text-muted-foreground">
                    {t("imports.preview.duplicates", { count: checked.counts.duplicates })}
                  </li>
                  <li className={checked.counts.failed > 0 ? "text-destructive" : "text-muted-foreground"}>
                    {t("imports.preview.failed", { count: checked.counts.failed })}
                  </li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  {t("imports.columnsUsed", {
                    columns: checked.columns.map((c) => `${c.field} ← ${c.header}`).join(" · "),
                  })}
                  {checked.ignored.length > 0
                    ? ` ${t("imports.columnsIgnored", { columns: checked.ignored.join(", ") })}`
                    : ""}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={problemsOnly}
                    onChange={(e) => setProblemsOnly(e.target.checked)}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {t("imports.problemsOnly")}
                </label>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("imports.noProblems")}</p>
                ) : (
                  <Table>
                    <TableCaption className="sr-only">{t("imports.previewTitle")}</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-0">{t("imports.row")}</TableHead>
                        <TableHead>{t("imports.status")}</TableHead>
                        {previewHeaders.map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                        <TableHead>{t("imports.notes")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="tabular-nums">{r.row}</TableCell>
                          <TableCell>
                            <Badge variant={TONE[r.status]}>{t(`imports.status.${r.status}`)}</Badge>
                          </TableCell>
                          {r.cells.map((value, i) => (
                            <TableCell
                              key={previewHeaders[i] ?? i}
                              className="max-w-48 truncate"
                              title={value}
                            >
                              {value}
                            </TableCell>
                          ))}
                          <TableCell className="min-w-48 text-xs whitespace-normal">
                            {r.messages.length > 0 ? (
                              <ul className="grid gap-0.5">
                                {r.messages.map((m, i) => (
                                  <li
                                    key={`${i}-${m}`}
                                    className={r.status === "error" ? "text-destructive" : undefined}
                                  >
                                    {m}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>{t("form.cancel")}</DialogClose>
                  <Button
                    onClick={importRows}
                    disabled={pending || checked.counts.ready === 0}
                    aria-busy={pending}
                  >
                    {pending
                      ? t("imports.importing")
                      : t("imports.importRows", { count: checked.counts.ready })}
                  </Button>
                </DialogFooter>
              </section>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
