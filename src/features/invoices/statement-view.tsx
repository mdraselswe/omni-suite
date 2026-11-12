import type { Route } from "next";
import Link from "next/link";
import type { formatters } from "@/components/data/format";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import type { Statement } from "./statement";

type Props = {
  statements: Statement[];
  f: ReturnType<typeof formatters>;
  business: string;
  clientName: string;
  from: string;
  to: string;
  /** Where an invoice number links to (staff page or the client portal). */
  invoiceHref: (invoiceId: string) => Route;
};

/** A client's statement of account: printable, one table per currency. */
export function StatementView({ statements, f, business, clientName, from, to, invoiceHref }: Props) {
  return (
    <article className="grid gap-8 surface p-6 text-card-foreground sm:p-10 print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="grid gap-1">
          <p className="font-heading text-xl font-semibold">{business}</p>
          <p className="text-sm text-muted-foreground">{t("statement.title")}</p>
        </div>
        <div className="grid gap-1 text-sm sm:text-right">
          <p className="font-medium">{clientName}</p>
          <p className="text-muted-foreground">
            {t("statement.period", { from: f.date(from), to: f.date(to) })}
          </p>
        </div>
      </header>

      {statements.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("statement.empty")}</p>
      ) : (
        statements.map((st) => (
          <section key={st.currency} className="grid gap-4" aria-label={st.currency}>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  { key: "statement.opening", amount: st.openingMinor },
                  { key: "statement.invoiced", amount: st.invoicedMinor },
                  { key: "statement.paid", amount: st.paidMinor },
                  { key: "statement.credited", amount: st.creditedMinor },
                  { key: "statement.closing", amount: st.closingMinor },
                ] as const
              ).map(({ key, amount }) => (
                <div key={key} className="grid gap-0.5 rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">{t(key, { currency: st.currency })}</dt>
                  <dd className="font-medium tabular-nums">{f.money(amount, st.currency)}</dd>
                </div>
              ))}
            </dl>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("form.date.label")}</TableHead>
                  <TableHead>{t("statement.detail")}</TableHead>
                  <TableHead className="text-right">{t("statement.amount")}</TableHead>
                  <TableHead className="text-right">{t("statement.balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="whitespace-nowrap">{f.date(from)}</TableCell>
                  <TableCell className="text-muted-foreground">{t("statement.openingLine")}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">
                    {f.money(st.openingMinor, st.currency)}
                  </TableCell>
                </TableRow>
                {st.entries.map((e, i) => (
                  <TableRow key={`${e.kind}-${e.invoiceId}-${i}`}>
                    <TableCell className="whitespace-nowrap">{f.date(e.date)}</TableCell>
                    <TableCell>
                      {t(`statement.kind.${e.kind}`)}{" "}
                      <Link
                        href={invoiceHref(e.invoiceId)}
                        className="font-medium underline-offset-4 hover:underline print:no-underline"
                      >
                        {e.number}
                      </Link>
                      {e.reference ? (
                        <span className="text-muted-foreground">
                          {" "}
                          {t("statement.creditNoteRef", { number: e.reference })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {e.amountMinor < 0n ? "−" : ""}
                      {f.money(e.amountMinor < 0n ? -e.amountMinor : e.amountMinor, st.currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {f.money(e.balanceMinor, st.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-medium">
                    {t("statement.closingLine", { date: f.date(to) })}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {f.money(st.closingMinor, st.currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </section>
        ))
      )}
    </article>
  );
}
