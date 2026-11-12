"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { authClient } from "@/lib/auth-client";

/** Signs out and stays on the invitation page, so the right person can continue. */
export function InviteSignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut();
      router.refresh();
    } catch {
      toast.error(t("form.failed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <Button type="button" variant="outline" onClick={signOut} disabled={pending} aria-busy={pending}>
      <LogOut aria-hidden="true" />
      {t("shell.signOut")}
    </Button>
  );
}
