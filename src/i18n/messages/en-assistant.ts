/** UI text for the client portal AI assistant and its settings. */
export const enAssistant = {
  "assistant.title": "Ask the assistant",
  "assistant.sub":
    "Quick answers about your invoices, proposals and projects with {business}. For anything else, send it to the team.",
  "assistant.name": "Assistant",
  "assistant.you": "You",
  "assistant.conversation": "Conversation",
  "assistant.empty": "Ask about what you owe, how a project is going or a proposal waiting for you.",
  "assistant.suggest.owe": "What do I owe right now?",
  "assistant.suggest.project": "How are my projects going?",
  "assistant.suggest.proposal": "Is any proposal waiting for me?",
  "assistant.question": "Your question",
  "assistant.placeholder": "Type your question…",
  "assistant.send": "Send",
  "assistant.thinking": "Thinking…",
  "assistant.note":
    "AI answers from your account details and can be wrong. The team confirms anything important.",
  "assistant.sendToTeam": "Send my question to the team",
  "assistant.askTeamInstead": "Ask the team instead",
  "assistant.sent": "Sent. The team will get back to you.",
  "assistant.off": "The assistant isn't available on your account.",
  "assistant.notReady": "The assistant isn't available right now",
  "assistant.notReadySub": "Please contact {business} directly.",
  "assistant.tooLong": "Write a question of up to 1,000 characters.",
  "assistant.limit":
    "You've asked {limit} questions today. Try again tomorrow, or send your question to the team.",
  "assistant.handoffLimit": "You've sent {limit} questions to the team today. They'll reply soon.",
  "assistant.handoffTitle": "Question from {person} ({client})",

  "assistant.settings.tab": "AI assistant",
  "assistant.settings.title": "Client portal assistant",
  "assistant.settings.sub":
    "Clients can ask an AI assistant about their own invoices, proposals and projects in the portal. It never sees other clients.",
  "assistant.settings.provider": "Answers come from {provider}.",
  "assistant.settings.noProvider":
    "No AI provider has a key on this server yet, so clients won't see the assistant even when it's on.",
  "assistant.settings.trains":
    "{provider}'s free tier may use prompts to train its models. Client invoices and project details would be sent there: use a paid key before turning this on for real clients.",
  "assistant.settings.who": "Who gets the assistant",
  "assistant.mode.off": "Off",
  "assistant.mode.offHint": "No client sees the assistant.",
  "assistant.mode.all": "All clients",
  "assistant.mode.allHint": "Every client with portal access, including new ones.",
  "assistant.mode.selected": "Only the clients ticked below",
  "assistant.mode.selectedHint": "Pick clients one by one, e.g. to try it with a few first.",
  "assistant.settings.clients": "Clients",
  "assistant.settings.clientsSub": 'Used when "Only the clients ticked below" is chosen.',
  "assistant.settings.noClients": "No clients yet.",
  "assistant.settings.inactive": "Inactive",
  "assistant.settings.portalUsers": "Portal users: {count}",
  "assistant.settings.noPortalUsers": "No portal access yet",
  "assistant.settings.save": "Save",
  "assistant.settings.saved": "Assistant settings saved.",
  "assistant.settings.roles":
    'Which portal roles may use it: Team → Roles → "Ask the AI assistant in the portal".',
  "assistant.settings.moduleOff": "The AI module is off",
  "assistant.settings.moduleOffSub":
    'Turn on "AI assistant" in Settings → Modules to set up the client portal assistant.',
} as const;
