import { t } from "@/i18n";
import { daysBetween } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** When an unpaid bill is due, in words (not only colour): "Due 3 Jul", "Due today", "4 days overdue". */
export function DueText({
  dueDate,
  today,
  formatted,
  owing,
  className,
}: {
  dueDate: string;
  today: string;
  /** The due date formatted for the business's locale. */
  formatted: string;
  /** Whether anything is still owed (paid and void bills just show the date). */
  owing: boolean;
  className?: string;
}) {
  if (!owing) return <span className={cn("text-muted-foreground", className)}>{formatted}</span>;
  if (dueDate < today) {
    const days = daysBetween(dueDate, today);
    return (
      <span className={cn("font-medium text-destructive", className)}>
        {days === 1 ? t("bills.overdueOne") : t("bills.overdueDays", { days })}
      </span>
    );
  }
  return (
    <span className={cn("text-muted-foreground", className)}>
      {dueDate === today ? t("bills.dueToday") : t("bills.dueOn", { date: formatted })}
    </span>
  );
}
