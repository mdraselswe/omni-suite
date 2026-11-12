import { type NextRequest } from "next/server";
import { canBackUpEverything } from "@/features/backup";
import { today } from "@/lib/dates";
import { audit } from "@/server/audit";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import {
  EXPORT_PERMISSIONS,
  EXPORT_SCOPE,
  EXPORT_SETS,
  exportRows,
  exportTenant,
  toCsv,
  toTable,
  type ExportSet,
} from "@/server/export";
import { ForbiddenError } from "@/server/tenancy/context";

function isSet(name: string): name is ExportSet {
  return Object.hasOwn(EXPORT_SETS, name);
}

/**
 * Downloads: /api/t/<tenant>/export/all.json (everything) or /<set>.csv.
 * Optional ?from=&to= filter rows that have a `date` column. Each CSV set needs
 * its own permission with "all" scope (EXPORT_PERMISSIONS); the JSON holds everything, so it
 * needs the full-backup right (owner, or backup.manage plus every set). Every download is audited.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/t/[tenant]/export/[set]">) {
  const { tenant, set } = await params;
  try {
    if (set === "all.json") {
      const { ctx } = await actionContext(tenant, "backup.manage", "all");
      if (!(await canBackUpEverything(db(), ctx))) throw new ForbiddenError("backup.manage");
      const data = await exportTenant(db(), ctx.tenant.id);
      await audit(db(), {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        action: "backup.export",
        entityType: "backup",
        data: { format: "json" },
      });
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${ctx.tenant.slug}-${today(ctx.tenant.settings.timezone)}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    const name = set.replace(/\.csv$/, "");
    if (!set.endsWith(".csv") || !isSet(name)) return new Response("Not found", { status: 404 });
    // Each set has its own guard (leads → leads.read, audit_log → audit.read, …).
    const { ctx } = await actionContext(tenant, EXPORT_PERMISSIONS[name], EXPORT_SCOPE);
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    let rows = await exportRows(db(), ctx.tenant.id, name);
    await audit(db(), {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "export.csv",
      entityType: "export",
      data: { set: name, from, to },
    });
    if (from || to) {
      rows = rows.filter((r) => {
        const d = typeof r.date === "string" ? r.date : "";
        return !d || ((!from || d >= from) && (!to || d <= to));
      });
    }
    return new Response(`﻿${toCsv(toTable(rows))}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${ctx.tenant.slug}-${name}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw error;
  }
}
