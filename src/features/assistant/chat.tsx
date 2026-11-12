"use client";

import { Check, Send, Sparkles, UserRound } from "lucide-react";
import { useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { askAssistantAction, sendToTeamAction } from "./actions";

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; needsTeam: boolean; question: string; sent: boolean };

/** The client portal assistant: a short conversation kept in this page only (nothing is stored). */
export function AssistantChat({ tenant, maxLength }: { tenant: string; maxLength: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [sending, startSending] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);

  function ask(text: string) {
    const q = text.trim();
    if (q.length < 2 || pending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((list) => [...list, { role: "user", content: q }]);
    setDraft("");
    setError("");
    startTransition(async () => {
      const result = await askAssistantAction(tenant, { question: q, history });
      if (result.ok) {
        setMessages((list) => [
          ...list,
          { role: "assistant", ...result.data, content: result.data.answer, question: q, sent: false },
        ]);
      } else {
        // Give the question back so it isn't lost.
        setMessages((list) => list.slice(0, -1));
        setDraft(q);
        setError(result.message);
      }
      input.current?.focus();
    });
  }

  function toTeam(index: number, question: string) {
    setError("");
    startSending(async () => {
      const result = await sendToTeamAction(tenant, question);
      if (result.ok) {
        setMessages((list) =>
          list.map((m, i) => (i === index && m.role === "assistant" ? { ...m, sent: true } : m)),
        );
      } else {
        setError(result.message);
      }
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(draft);
    }
  }

  const suggestions = [
    t("assistant.suggest.owe"),
    t("assistant.suggest.project"),
    t("assistant.suggest.proposal"),
  ];

  return (
    <div className="grid gap-4 surface p-4">
      <div aria-live="polite" aria-busy={pending} className="grid gap-3">
        {messages.length === 0 ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t("assistant.empty")}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => ask(s)}
                  disabled={pending}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="grid gap-3" aria-label={t("assistant.conversation")}>
            {messages.map((m, i) => (
              <li key={i} className={cn("flex gap-2", m.role === "user" && "flex-row-reverse")}>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full",
                    m.role === "user"
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {m.role === "user" ? <UserRound className="size-4" /> : <Sparkles className="size-4" />}
                </span>
                <div className={cn("grid max-w-[85%] gap-2", m.role === "user" && "justify-items-end")}>
                  <p className="sr-only">{m.role === "user" ? t("assistant.you") : t("assistant.name")}</p>
                  <p
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    {m.content}
                  </p>
                  {m.role === "assistant" ? (
                    m.sent ? (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Check aria-hidden="true" className="size-3.5" />
                        {t("assistant.sent")}
                      </p>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant={m.needsTeam ? "default" : "ghost"}
                        className="justify-self-start"
                        disabled={sending}
                        onClick={() => toTeam(i, m.question)}
                      >
                        {m.needsTeam ? t("assistant.sendToTeam") : t("assistant.askTeamInstead")}
                      </Button>
                    )
                  ) : null}
                </div>
              </li>
            ))}
            {pending ? (
              <li className="flex gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Sparkles aria-hidden="true" className="size-4" />
                </span>
                <div
                  className="grid w-2/3 gap-2 rounded-lg bg-muted px-3 py-2"
                  aria-label={t("assistant.thinking")}
                >
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </li>
            ) : null}
          </ol>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form onSubmit={submit} className="grid gap-2">
        <label htmlFor="assistant-question" className="sr-only">
          {t("assistant.question")}
        </label>
        <Textarea
          id="assistant-question"
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          rows={2}
          placeholder={t("assistant.placeholder")}
          disabled={pending}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t("assistant.note")}</p>
          <Button type="submit" disabled={pending || draft.trim().length < 2}>
            <Send aria-hidden="true" />
            {pending ? t("assistant.thinking") : t("assistant.send")}
          </Button>
        </div>
      </form>
    </div>
  );
}
