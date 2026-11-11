import { initials } from "@/lib/shell";
import { cn } from "@/lib/utils";

/** The business logo, or its initials on the brand gradient when there is no logo. */
export function BrandMark({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl?: string;
  className?: string;
}) {
  if (logoUrl) {
    return (
      // A business's own logo from any https host: next/image would need every host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" className={cn("size-10 shrink-0 rounded-xl object-contain", className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-1 font-heading text-sm font-semibold",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
