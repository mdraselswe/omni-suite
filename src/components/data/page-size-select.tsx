"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { appHref } from "@/lib/href";

/**
 * Select inside a GET form that applies itself on change (client navigation).
 * Without JavaScript the form's own submit button does the same.
 */
export function AutoSubmitSelect(props: Omit<ComponentProps<"select">, "onChange">) {
  const router = useRouter();
  return (
    <select
      {...props}
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        const params = new URLSearchParams();
        for (const [key, value] of new FormData(form)) {
          if (typeof value === "string" && value) params.append(key, value);
        }
        const query = params.toString();
        router.push(appHref(`${window.location.pathname}${query ? `?${query}` : ""}`));
      }}
    />
  );
}
