"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/** Copies an invitation link, with a short "copied" state for sighted and screen-reader users. */
export function CopyLinkButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t("team.linkCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("team.copyFailed"));
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? t("team.linkCopied") : t("form.copy")}
    </Button>
  );
}
