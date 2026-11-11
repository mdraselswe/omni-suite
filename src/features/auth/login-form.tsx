"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { t } from "@/i18n";
import { authClient } from "@/lib/auth-client";

export type DemoAccount = { email: string; label: string };

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.6c2-1.9 3.2-4.7 3.2-8.2z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.7 14c-.2-.7-.4-1.4-.4-2s.1-1.4.4-2V7.1H2A11 11 0 0 0 1 12c0 1.8.4 3.4 1.1 4.9L5.7 14z"
      />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2 7.1L5.7 10C6.6 7.4 9.1 5.4 12 5.4z"
      />
    </svg>
  );
}

/** Sign-in and sign-up: Google, email + password (when enabled), demo accounts in development. */
export function LoginForm({
  google,
  emailPassword,
  demoAccounts,
  demoPassword,
  next,
}: {
  google: boolean;
  emailPassword: boolean;
  demoAccounts: readonly DemoAccount[];
  demoPassword: string;
  next: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const done = () => {
    router.push(next as Route);
    router.refresh();
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    setBusy(true);
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(data.get("name") ?? "") });
    setBusy(false);
    if (result.error) toast.error(result.error.message ?? t("auth.failed"));
    else done();
  }

  async function demo(email: string) {
    setBusy(true);
    const result = await authClient.signIn.email({ email, password: demoPassword });
    setBusy(false);
    if (result.error) toast.error(t("auth.demoMissing"));
    else done();
  }

  return (
    <div className="grid gap-5">
      {google ? (
        <Button
          variant="outline"
          size="lg"
          disabled={busy}
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
        >
          <GoogleIcon />
          {t("auth.google")}
        </Button>
      ) : null}

      {emailPassword ? (
        <>
          {google ? (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              {t("auth.or")}
              <Separator className="flex-1" />
            </div>
          ) : null}
          <form onSubmit={submit} method="post" className="grid gap-3">
            {mode === "signup" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="name">{t("auth.name")}</Label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={10}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
              />
            </div>
            <Button type="submit" size="lg" disabled={busy}>
              {mode === "signin" ? t("auth.signIn") : t("auth.signUp")}
            </Button>
          </form>
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? t("auth.toSignUp") : t("auth.toSignIn")}
          </button>
        </>
      ) : null}

      {!google && !emailPassword && demoAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("auth.noMethods")}</p>
      ) : null}

      {demoAccounts.length > 0 ? (
        <div className="grid gap-2 rounded-lg border border-dashed p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("auth.demoTitle")}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {demoAccounts.map((a) => (
              <Button
                key={a.email}
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => demo(a.email)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
