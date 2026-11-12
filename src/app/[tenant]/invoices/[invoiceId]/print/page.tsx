import Link from "next/link";
import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { getInvoice, InvoiceDocument, PrintButton } from "@/features/invoices";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

/** Clean printable invoice: use the browser's Print → Save as PDF. */
export default async function PrintInvoicePage({
  params,
}: PageProps<"/[tenant]/invoices/[invoiceId]/print">) {
  const { tenant, invoiceId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "invoices.read");
  const row = await getInvoice(db(), ctx.tenant.id, invoiceId);
  if (!row) notFound();
  const { invoice: inv, client } = row;
  const settings = ctx.tenant.settings;

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={tenantHref(tenant, `invoices/${inv.id}`)}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {inv.number}
        </Link>
        <PrintButton />
      </div>
      <InvoiceDocument
        inv={inv}
        client={client}
        settings={settings}
        business={settings.branding.displayName || ctx.tenant.name}
        f={formatters(ctx)}
      />
    </div>
  );
}
