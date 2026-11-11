import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/i18n";

export default function SuspendedPage() {
  return (
    <main id="content" className="mx-auto grid min-h-svh max-w-md content-center gap-4 px-4 text-center">
      <h1 className="font-heading text-2xl font-semibold">{t("suspended.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("suspended.body")}</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        {t("notFound.cta")}
      </Link>
    </main>
  );
}
