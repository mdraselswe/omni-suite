"use client";

import { Bell } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
import { cn } from "@/lib/utils";
import type { FormState } from "@/components/form/action-form";

export type BellItem = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  when: string;
};

/** Header bell: unread count, recent notifications, mark all read. Data comes from the server layout. */
export function NotificationBell({
  items,
  unread,
  markRead,
}: {
  items: readonly BellItem[];
  unread: number;
  markRead: (state: FormState) => Promise<FormState>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label =
    unread > 0 ? `${t("notif.title")}: ${t("notif.unread", { count: unread })}` : t("notif.title");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative size-10 rounded-full header-control"
            aria-label={label}
          />
        }
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>{t("notif.title")}</span>
            {unread > 0 ? (
              <span className="text-xs font-normal text-muted-foreground">
                {t("notif.unread", { count: unread })}
              </span>
            ) : null}
          </DropdownMenuLabel>
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("notif.none")}</p>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="grid items-start gap-0.5"
                onClick={() => {
                  if (n.link) router.push(n.link as Route);
                }}
              >
                <span className={cn("flex items-center gap-2 text-sm", !n.read && "font-semibold")}>
                  {!n.read ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  ) : null}
                  <span className="line-clamp-1">{n.title}</span>
                </span>
                {n.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span> : null}
                <span className="text-[11px] text-muted-foreground">{n.when}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        {unread > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={pending}
              onClick={() => startTransition(async () => void (await markRead(null)))}
            >
              {t("notif.markRead")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
