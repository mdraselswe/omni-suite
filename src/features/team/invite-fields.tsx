"use client";

import { useState } from "react";
import { FieldError } from "@/components/form/action-form";
import { SelectField, TextField } from "@/components/form/field";
import { t } from "@/i18n";

type RoleOption = { id: string; name: string; audience: "internal" | "client"; description: string };

/** Invite form body: the role list and client picker follow the chosen kind of access. */
export function InviteFields({
  roles,
  clients,
}: {
  roles: readonly RoleOption[];
  clients: readonly { value: string; label: string }[];
}) {
  const [kind, setKind] = useState<"internal" | "client">("internal");
  const shown = roles.filter((r) => r.audience === kind);
  return (
    <>
      <TextField name="email" label={t("auth.email")} type="email" autoComplete="off" required />
      <SelectField
        name="kind"
        label={t("team.kind")}
        options={[
          { value: "internal", label: t("team.kind.internal") },
          { value: "client", label: t("team.kind.client") },
        ]}
        value={kind}
        onChange={(e) => setKind(e.target.value === "client" ? "client" : "internal")}
      />
      {kind === "client" ? <SelectField name="clientId" label={t("team.client")} options={clients} /> : null}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("team.roles")}</legend>
        {shown.map((r) => (
          <label key={r.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="roleIds" value={r.id} className="mt-0.5 size-4 accent-primary" />
            <span className="grid">
              <span>{r.name}</span>
              {r.description ? <span className="text-xs text-muted-foreground">{r.description}</span> : null}
            </span>
          </label>
        ))}
        <FieldError name="roleIds" />
      </fieldset>
    </>
  );
}
