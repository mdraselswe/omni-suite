"use client";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/** A page inside a business failed: the error shows inside the app shell, so the menu stays usable. */
export default function TenantError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div
      role="alert"
      className="grid min-h-[50svh] place-content-center justify-items-center gap-4 py-16 text-center"
    >
      <h1 className="font-heading text-2xl font-semibold">{t("error.title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("error.body")}</p>
      <Button size="lg" onClick={() => retry()}>
        {t("error.retry")}
      </Button>
    </div>
  );
}
