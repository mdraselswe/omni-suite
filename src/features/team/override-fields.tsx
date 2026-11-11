"use client";

import { useState } from "react";
import { SelectField, TextField } from "@/components/form/field";
import { t } from "@/i18n";

type PermissionOption = { key: string; label: string; scopes: readonly ("own" | "assigned" | "all")[] };

/** Per-person change: the scope list follows the chosen permission. */
export function OverrideFields({ permissions }: { permissions: readonly PermissionOption[] }) {
  const [key, setKey] = useState(permissions[0]?.key ?? "");
  const scopes = permissions.find((p) => p.key === key)?.scopes ?? ["all"];
  return (
    <>
      <SelectField
        name="permission"
        label={t("team.permission")}
        options={permissions.map((p) => ({ value: p.key, label: p.label }))}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="effect"
          label={t("team.effect")}
          options={[
            { value: "allow", label: t("team.effect.allow") },
            { value: "deny", label: t("team.effect.deny") },
          ]}
        />
        <SelectField
          key={key}
          name="scope"
          label={t("team.scope")}
          options={scopes.map((s) => ({ value: s, label: t(`scope.${s}`) }))}
          defaultValue={scopes[scopes.length - 1]}
        />
      </div>
      <TextField name="expires" label={t("team.expires")} type="date" />
      <TextField name="reason" label={t("team.reason")} />
    </>
  );
}
