"use client";

import { Check, LogOut, Plus, Shield } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/shell";

export type MenuTenant = { slug: string; name: string; current: boolean };

/** Account menu: switch business, platform admin, sign out. */
export function UserMenu({
  user,
  tenants,
  isPlatformAdmin,
}: {
  user: { name: string; email: string; image: string | null };
  tenants: readonly MenuTenant[];
  isPlatformAdmin: boolean;
}) {
  const router = useRouter();
  const go = (href: string) => router.push(href as Route);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="size-10 rounded-full header-control p-0"
            aria-label={`${t("shell.account")}: ${user.name}`}
          />
        }
      >
        <Avatar className="size-10 after:hidden">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback className="bg-primary text-primary-foreground">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="grid px-2 py-2 text-sm leading-tight">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("shell.businesses")}</DropdownMenuLabel>
          {tenants.map((tenant) => (
            <DropdownMenuItem key={tenant.slug} onClick={() => go(`/${tenant.slug}`)}>
              <span className="flex-1 truncate">{tenant.name}</span>
              {tenant.current ? <Check className="size-4" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => go("/onboarding")}>
            <Plus className="size-4" aria-hidden="true" />
            {t("shell.newBusiness")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {isPlatformAdmin ? (
          <DropdownMenuItem onClick={() => go("/admin")}>
            <Shield className="size-4" aria-hidden="true" />
            {t("shell.platformAdmin")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {t("shell.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
