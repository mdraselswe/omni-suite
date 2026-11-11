import { cn } from "@/lib/utils";

/** Thin progress bar. `value` is 0–100; the label is read by screen readers. */
export function Progress({
  value,
  label,
  className,
  tone = "primary",
}: {
  value: number;
  label: string;
  className?: string;
  tone?: "primary" | "success" | "warning" | "destructive";
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full animate-grow-x rounded-full",
          tone === "primary" && "bg-primary",
          tone === "success" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "destructive" && "bg-destructive",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
