"use server";

import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/action";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { acceptInvitation } from "./service";

export async function acceptInvitationAction(token: string): Promise<ActionState> {
  let target = "/";
  const state = await runAction(async () => {
    const user = await requireUser();
    const result = await acceptInvitation(db(), token, user);
    target = result.kind === "client" ? `/${result.slug}/portal` : `/${result.slug}`;
  });
  if (state?.ok) redirect(target as "/");
  return state;
}
