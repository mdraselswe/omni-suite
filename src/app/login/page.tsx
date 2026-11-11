import { Cloud, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/layout/brand-mark";
import { site } from "@/config";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, LoginForm, LoginIllustration } from "@/features/auth";
import { t } from "@/i18n";
import { authMethods } from "@/server/auth/auth";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

/** Only same-app paths are allowed as the post-login destination. */
function safeNext(value: string | string[] | undefined): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const POINTS = [
  { icon: ShieldCheck, label: "auth.point.secure" },
  { icon: Cloud, label: "auth.point.backup" },
  { icon: Users, label: "auth.point.portal" },
] as const;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  if (await getSessionUser()) redirect(next as "/");
  const methods = authMethods();
  return (
    <main
      id="content"
      className="grid min-h-svh gap-6 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
    >
      <div className="flex flex-col px-3 py-4 sm:px-8 lg:px-12 xl:px-20">
        <div className="flex items-center gap-2.5">
          <BrandMark name={site.name} className="size-9" />
          <span className="font-heading text-lg font-semibold">{site.name}</span>
        </div>
        <div className="my-auto w-full max-w-md animate-rise py-10">
          <h1 className="font-heading text-4xl font-semibold tracking-tight">{t("auth.title")}</h1>
          <p className="mt-2 mb-8 text-sm text-muted-foreground">{t("auth.sub")}</p>
          <LoginForm
            google={methods.google}
            emailPassword={methods.emailPassword}
            demoAccounts={methods.devLogin ? DEMO_ACCOUNTS.map(({ email, label }) => ({ email, label })) : []}
            demoPassword={methods.devLogin ? DEMO_PASSWORD : ""}
            next={next}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("auth.copyright", { year: new Date().getFullYear(), name: site.name })}
        </p>
      </div>
      <aside className="relative hidden flex-col gap-10 overflow-hidden rounded-3xl bg-brand-panel p-10 lg:flex xl:p-14">
        <span
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary-foreground/8"
          aria-hidden="true"
        />
        <div className="relative grid max-w-lg gap-3">
          <h2 className="font-heading text-4xl leading-tight font-medium">{t("auth.panelTitle")}</h2>
          <p className="text-base">{t("auth.panelSub")}</p>
        </div>
        <LoginIllustration className="my-auto" />
        <ul className="relative flex flex-wrap gap-x-8 gap-y-3 text-sm font-medium">
          {POINTS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon className="size-4" aria-hidden="true" />
              {t(label)}
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
