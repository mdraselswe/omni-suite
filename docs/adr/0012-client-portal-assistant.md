# 12. Client portal AI assistant

## Decision

- Clients get an AI assistant in the portal (`/<business>/portal/assistant/`). It answers from one client's own account only: `clientFacts` reads that client's latest invoices, proposals and projects through the same portal queries and permissions as the portal pages (`portal.invoices`, `portal.proposals`, `portal.projects`). Nothing about other clients or the business's own books is ever in the prompt.
- Who gets it is the business's choice, in Settings → AI assistant: `off` (default), `all` clients, or `selected` clients (`tenant.settings.portalAssistant`). Inside a client, the `portal.assistant` permission (AI module) decides which portal roles may use it. The setting is applied where module switches are (`switchedOff` in `src/server/tenancy/context.ts`), so menus, `hasPermission` and actions agree. The menu entry also needs an AI provider with a key.
- The facts go in the system prompt; the client's words only go in user messages. The answer is JSON (`answer`, `needsTeam`), shown as plain text (never HTML or markdown). The model is told not to promise prices, refunds or dates and to set `needsTeam` instead.
- The conversation lives in the browser only. The server stores usage counts, not questions or answers. Each question resends the last `historyMessages` turns.
- "Send to the team" notifies (in-app and email) everyone with `clients.write`, with the question as the body and a link to the client.
- Limits: `dailyQuestionsPerClient` and `dailyHandoffsPerClient` per client and day (all its portal users together), on top of the per-member and per-business AI allowances.

## Why

Clients ask the same questions (what do I owe, where is my project); answering from their own records saves the team time. Scoping the facts per client, rather than giving the model tools or database access, makes it impossible for a prompt injection to reach another client's data. Off by default because the client's details go to the AI provider, and some free tiers train on prompts.

## Not done (yet)

- Saved conversations and a ticket inbox: hand-offs arrive as notifications and email.
- Answers from files, task comments or the business's FAQ.
- Streaming answers.
