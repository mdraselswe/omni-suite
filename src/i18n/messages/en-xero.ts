/** UI text for Phase 7: Xero integration. */
export const enXero = {
  "xero.title": "Xero",
  "xero.sub":
    "Send your invoices, clients and payments to Xero automatically, so your accountant sees the same numbers.",
  "xero.notConfigured":
    "Xero isn't set up on this OmniSuite server yet. The platform admin needs to add a Xero app (see the setup guide).",
  "xero.denied": "Xero access was not given. Try again when you're ready.",
  "xero.noOrg": "That Xero login has no organisation. Pick an organisation when Xero asks.",
  "xero.callbackFailed": "Couldn't finish connecting to Xero. Please try again.",
  "xero.statusConnected": "Connected",
  "xero.statusAttention": "Needs attention",
  "xero.connected": "Connected to {name}",
  "xero.notConnected": "Xero isn't connected",
  "xero.notConnectedHint": "Connect once and OmniSuite keeps Xero up to date every hour.",
  "xero.connect": "Connect Xero",
  "xero.reconnect": "Reconnect Xero",
  "xero.reconnectNeeded":
    "Xero access has ended (it expires after 60 days without a sync, or was removed in Xero). Reconnect to carry on.",
  "xero.disconnect": "Disconnect",
  "xero.disconnected": "Xero disconnected",
  "xero.syncNow": "Sync now",
  "xero.queued": "Sync started. It runs in the background.",
  "xero.lastSync": "Last sync: {when}",
  "xero.never": "never",
  "xero.lastError": "Last problem: {error}",
  "xero.whatSyncs":
    "What goes to Xero: clients with invoices (as contacts), every invoice that isn't a draft, and recorded payments. Drafts stay here. It's one way: changes in Xero don't come back.",
  "xero.settingsTitle": "Xero accounts",
  "xero.settingsSub": "Codes from your Xero chart of accounts (Accounting → Chart of accounts).",
  "xero.salesAccount": "Sales account code",
  "xero.salesAccountHint": "Income account for invoice lines, e.g. 200 (Sales).",
  "xero.paymentAccount": "Bank account code for payments",
  "xero.paymentAccountHint": "The bank account payments land in, e.g. 090. It must allow payments.",
  "xero.taxType": "GST tax type",
  "xero.taxTypeHint":
    "For lines with GST, e.g. OUTPUT (GST on Income). Lines without GST go as GST Free Income.",
  "xero.save": "Save",
  "xero.settingsSaved": "Xero settings saved",
  "xero.codeInvalid": "Use the account code from Xero (letters and numbers, up to 10).",
  "xero.taxTypeInvalid": "Use a Xero tax type code, e.g. OUTPUT.",
} as const;
