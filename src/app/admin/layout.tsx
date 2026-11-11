import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/i18n";
import { requirePlatformAdmin } from "@/server/auth/session";

export const metadata: Metadata = { title: "Platform admin" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePlatformAdmin();
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <p className="font-heading text-lg font-semibold text-primary">OmniSuite</p>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            {t("admin.back")}
          </Link>
        </div>
      </header>
      <main id="content" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
