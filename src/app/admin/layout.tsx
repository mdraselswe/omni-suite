import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ButtonLink } from "@/components/ui/button-link";
import { Badge } from "@/components/ui/badge";
import { site } from "@/config";
import { t } from "@/i18n";
import { requirePlatformAdmin } from "@/server/auth/session";

export const metadata: Metadata = { title: "Platform admin" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePlatformAdmin();
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark name={site.name} />
            <p className="truncate font-heading text-lg font-semibold">{site.name}</p>
            <Badge variant="soft" className="hidden sm:inline-flex">
              {t("admin.title")}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <ButtonLink href="/" variant="outline" className="rounded-full">
              <ArrowLeft aria-hidden="true" />
              {t("admin.back")}
            </ButtonLink>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="content" className="mx-auto max-w-6xl animate-rise px-4 pt-2 pb-10 md:px-8">
        {children}
      </main>
    </div>
  );
}
