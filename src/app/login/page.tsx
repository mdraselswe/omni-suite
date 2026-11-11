import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, LoginForm } from "@/features/auth";
import { t } from "@/i18n";
import { authMethods } from "@/server/auth/auth";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

/** Only same-app paths are allowed as the post-login destination. */
function safeNext(value: string | string[] | undefined): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  if (await getSessionUser()) redirect(next as "/");
  const methods = authMethods();
  return (
    <main id="content" className="grid min-h-svh place-items-center px-4 py-12">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid gap-1 text-center">
          <p className="font-heading text-3xl font-semibold tracking-tight text-primary">OmniSuite</p>
          <h1 className="text-lg font-medium">{t("auth.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.sub")}</p>
        </div>
        <LoginForm
          google={methods.google}
          emailPassword={methods.emailPassword}
          demoAccounts={methods.devLogin ? DEMO_ACCOUNTS.map(({ email, label }) => ({ email, label })) : []}
          demoPassword={methods.devLogin ? DEMO_PASSWORD : ""}
          next={next}
        />
      </div>
    </main>
  );
}
