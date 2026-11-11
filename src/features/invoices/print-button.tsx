"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/** Opens the browser's print dialog (save as PDF from there). */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden="true" />
      {t("form.print")}
    </Button>
  );
}
