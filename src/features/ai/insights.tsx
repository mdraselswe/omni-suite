"use client";

import { Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { businessInsightsAction } from "./actions";
import type { Insight } from "./prompts";

type State = { kind: "idle" } | { kind: "error"; message: string } | { kind: "done"; insights: Insight[] };

/** On-demand recommendations from the dashboard numbers (each click is one AI request). */
export function BusinessInsights({ tenant }: { tenant: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await businessInsightsAction(tenant);
      setState(
        result.ok ? { kind: "done", insights: result.data } : { kind: "error", message: result.message },
      );
    });
  }

  return (
    <div className="grid gap-4">
      <div aria-live="polite" aria-busy={pending}>
        {pending ? (
          <ul className="grid gap-3" aria-label={t("ai.insights.working")}>
            {[0, 1, 2].map((i) => (
              <li key={i} className="grid gap-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-full" />
              </li>
            ))}
          </ul>
        ) : state.kind === "done" ? (
          <ol className="grid gap-4">
            {state.insights.map((insight, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
                >
                  <Lightbulb className="size-4" />
                </span>
                <span className="grid gap-0.5">
                  <span className="font-medium">{insight.title}</span>
                  <span className="text-sm text-muted-foreground">{insight.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : state.kind === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("ai.insights.empty")}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={run}
          disabled={pending}
          variant={state.kind === "done" ? "outline" : "default"}
        >
          {state.kind === "done" ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {pending
            ? t("ai.insights.working")
            : state.kind === "done"
              ? t("ai.insights.again")
              : t("ai.insights.run")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("ai.insights.note")}</p>
      </div>
    </div>
  );
}
