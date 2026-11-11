"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { authClient } from "@/lib/auth-client";

/** Step 1: ask for a reset link. Always answers the same way, so it can't reveal who has an account. */
export function ResetRequestForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setBusy(true);
    const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password/" });
    setBusy(false);
    // Rate limiting is the only error worth showing; anything else looks like success.
    if (result.error?.status === 429) toast.error(t("account.tooManyRequests"));
    else setSent(true);
  }

  if (sent) {
    return (
      <p role="status" className="rounded-lg border bg-muted p-4 text-sm">
        {t("account.resetSent")}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" className="h-11" required />
      </div>
      <Button type="submit" size="lg" className="h-11 w-full" disabled={busy} aria-busy={busy}>
        {busy ? t("form.saving") : t("account.sendResetLink")}
      </Button>
    </form>
  );
}

/** Step 2 (from the emailed link): choose a new password. */
export function NewPasswordForm({ token, minLength }: { token: string; minLength: number }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword.length < minLength) return setError(t("account.passwordTooShort", { min: minLength }));
    if (newPassword !== String(data.get("confirmPassword") ?? ""))
      return setError(t("account.passwordMismatch"));
    setError("");
    setBusy(true);
    const result = await authClient.resetPassword({ newPassword, token });
    setBusy(false);
    if (result.error) setError(t("account.resetInvalid"));
    else setDone(true);
  }

  if (done) {
    return (
      <div role="status" className="grid gap-4">
        <p className="rounded-lg border bg-muted p-4 text-sm">{t("account.resetDone")}</p>
        <ButtonLink href="/login" size="lg" className="justify-self-start">
          {t("auth.signIn")}
        </ButtonLink>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="newPassword">{t("account.newPassword")}</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          className="h-11"
          aria-describedby="password-error"
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirmPassword">{t("account.confirmPassword")}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          className="h-11"
          aria-describedby="password-error"
          required
        />
      </div>
      {error ? (
        <p id="password-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="h-11 w-full" disabled={busy} aria-busy={busy}>
        {busy ? t("form.saving") : t("account.setPassword")}
      </Button>
    </form>
  );
}
