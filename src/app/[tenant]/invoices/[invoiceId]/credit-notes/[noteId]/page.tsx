import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { CreditNoteDocument, getCreditNote, getInvoice, PrintButton } from "@/features/invoices";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

/** A printable credit note (Print → Save as PDF to send it). */
export default async function CreditNotePage({
  params,
}: PageProps<"/[tenant]/invoices/[invoiceId]/credit-notes/[noteId]">) {
  const { tenant, invoiceId, noteId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const database = db();
  const [row, note] = await Promise.all([
    getInvoice(database, ctx.tenant.id, invoiceId),
    getCreditNote(database, ctx.tenant.id, noteId),
  ]);
  if (!row || !note || note.invoiceId !== row.invoice.id) notFound();
  const settings = ctx.tenant.settings;

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={tenantHref(tenant, `invoices/${row.invoice.id}`)}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {row.invoice.number}
        </Link>
        <PrintButton />
      </div>
      <CreditNoteDocument
        note={note}
        inv={row.invoice}
        client={row.client}
        settings={settings}
        business={settings.branding.displayName || ctx.tenant.name}
        f={formatters(ctx)}
      />
    </div>
  );
}
