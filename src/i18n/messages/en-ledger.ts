/** UI text for GST/BAS, write-offs, cash position and other ledger rules. */
export const enLedger = {
  "invoices.paymentInFuture": "The payment date is in the future. Record a payment on the day it arrives.",
  // Tax inside ledger amounts
  "finance.taxIncluded": "{tax} included (optional)",
  "finance.taxIncludedHint":
    "The {tax} inside this amount. Profit counts the amount without it; the tax report adds it up.",
  "finance.taxWorkOut": "Work out {rate}% {tax}",
  "finance.taxTooBig": "The tax can't be more than the amount, and only income and expenses carry tax.",
  "finance.partnerRequired": "Choose the partner this money belongs to.",
  "finance.capitalHasUnits":
    "This money bought ownership units. Record an ownership adjustment on the Partners page instead of reversing it.",

  // BAS / tax report
  "finance.taxNet": "{tax} to pay",
  "finance.taxOwed": "Owed to the tax office for these dates (cash basis)",
  "finance.taxRefund": "More paid than collected: a refund is due",
  "finance.basTitle": "{tax} report",
  "finance.basSub":
    "Cash basis: {tax} on money received and paid between these dates. Use it to fill in your BAS.",
  "finance.basSales": "Total sales received",
  "finance.basSalesTax": "{tax} on sales",
  "finance.basPurchases": "Total purchases paid",
  "finance.basPurchaseTax": "{tax} on purchases (claimable)",
  "finance.basAccrual":
    "Reporting on the accrual basis instead? {tax} on invoices issued in these dates: {amount}.",

  // Cash position
  "dash.cashHintBase": "Accounts in {currency}",
  "dash.cashHintMixed": "{currency} accounts plus {others} at today's rate",
  "dash.cashHintUnconverted": "{currency} accounts only. Also held: {others}",
  "dash.runwayHintMonths": "Cash ÷ average monthly spend (last {months} months)",
  "dash.receivableForeign": "Also owed: {amounts}",

  // Invoices
  "invoices.totalPositive": "The invoice total must be more than zero. Use a refund for money going back.",
  "invoices.writeOff": "Write off the rest",
  "invoices.writeOffTitle": "Write off {amount}?",
  "invoices.writeOffBody":
    "The client won't owe this any more and the invoice counts as settled. Use it for short payments and bad debts. Nothing is added to the ledger.",
  "invoices.writeOffReason": "Reason (optional)",
  "invoices.writtenOff": "Written off",
  "invoices.writtenOffDone": "Balance written off.",
  "invoices.payRateHint":
    "This invoice is in {currency}: the exchange rate turns the payment into {base} for reports.",
  "invoices.paymentReversed": "Reversed",

  // Stripe fees and refunds
  "payments.feeCategory": "Payment processing fees",
  "payments.feeDescription": "Stripe fee for {number}",
  "payments.refundReason": "refunded in Stripe",
  "payments.refundedTitle": "Payment for {number} refunded",
  "payments.refundedBody":
    "The card payment was refunded in Stripe, so {number} is owed again. The ledger entry was reversed.",
  "payments.partialRefundTitle": "Part of the payment for {number} refunded",
  "payments.partialRefundBody":
    "Stripe refunded part of a card payment for {number}. Record the refund in Finance as an expense so the ledger matches the bank.",

  // Transfers between currencies
  "finance.toAmount": "Amount received ({currency})",
  "finance.toAmountHint": "What arrived in the other account after the bank's conversion and fees.",

  // Proposal → deposit, rest, project
  "proposals.invoiceDeposit": "Invoice a deposit",
  "proposals.invoiceDepositSub":
    "Bill part of the proposal up front. When the work is done, invoice the rest: the deposit is taken off.",
  "proposals.depositPercent": "Deposit (%)",
  "proposals.depositRange": "Enter a deposit between 1 and 99%.",
  "proposals.depositLine": "Deposit ({percent}%): {title}",
  "proposals.lessInvoiced": "Less already invoiced ({numbers})",
  "proposals.invoiceRest": "Invoice the rest ({amount})",
  "proposals.startProject": "Start the project",
  "proposals.openProject": "Open the project",

  // Client statement of account
  "statement.title": "Statement",
  "statement.period": "{from} to {to}",
  "statement.empty": "Nothing invoiced or paid up to this date.",
  "statement.opening": "Owed at start ({currency})",
  "statement.invoiced": "Invoiced",
  "statement.paid": "Paid",
  "statement.closing": "Owed at end ({currency})",
  "statement.detail": "Details",
  "statement.amount": "Amount",
  "statement.balance": "Balance",
  "statement.openingLine": "Balance brought forward",
  "statement.closingLine": "Balance owing on {date}",
  "statement.kind.invoice": "Invoice",
  "statement.kind.payment": "Payment for",
  "statement.kind.writeOff": "Written off on",

  // Aged receivables
  "aged.title": "Who owes what",
  "aged.sub": "Unpaid invoices by how late they are. Chase the right-hand columns first.",
  "aged.client": "Client",
  "aged.current": "Not due yet",
  "aged.d1_30": "1–30 days late",
  "aged.d31_60": "31–60 days",
  "aged.d61_90": "61–90 days",
  "aged.d90": "Over 90 days",
  "aged.total": "Total",
  "aged.totals": "All clients",
  "aged.none": "Nobody owes you anything right now.",
  "aged.statement": "Statement",

  // Client contact and billing details
  "clients.contactName": "Contact person",
  "clients.billingEmail": "Billing email",
  "clients.billingEmailHint":
    "Invoices and receipts go here, for example accounts@. Blank uses the main email.",

  // Lead follow-ups
  "leads.followUp": "Follow up on",
  "leads.followUpHint": "The day to get back to them. It shows as due on the board and dashboard.",
  "leads.followUpOn": "Follow up {date}",
  "leads.followUpDue": "Follow up due {date}",
  "leads.followUpsDue": "Follow-ups due ({count})",
  "leads.allLeads": "All leads",
  "dash.pipelineHintDue": "{count} open leads · {due} follow-ups due",

  // Payment reminders and resending
  "invoices.reminderTitle": "Reminder: invoice {number} from {name} is due {due}",
  "invoices.reminderBody": "{balance} is due on {due}. Thank you!",
  "invoices.reminderLateTitle": "Overdue: invoice {number} from {name}",
  "invoices.reminderLateBody":
    "{balance} was due on {due} and is still unpaid. Please pay it, or reply if something is wrong.",
  "invoices.resend": "Send reminder",
  "invoices.resendConfirm": "Send this invoice to the client again as a reminder?",
  "settings.replyTo": "Reply-to email",
  "settings.replyToHint":
    "When a client replies to an invoice or reminder, it goes here. Blank: replies aren't delivered.",
  "settings.reminders": "Payment reminders",
  "settings.remindersOn": "Remind clients about unpaid invoices automatically",
  "settings.reminderBefore": "Days before the due date",
  "settings.reminderBeforeHint": "0 sends no early reminder.",
  "settings.reminderAfter": "Days after the due date",
  "settings.reminderAfterHint": "Up to six, separated by commas, for example 1, 7, 14.",
  "settings.reminderDaysInvalid": "Use up to six numbers separated by commas, for example 1, 7, 14.",

  // Receipts on ledger rows
  "finance.attachReceipt": "Receipt",
  "finance.attachReceiptHint":
    "Attach the receipt or bill (photo or PDF). Your accountant can open it from the ledger.",
  "finance.receiptOpen": "Open {name}",

  // Partner statement
  "partners.statementBase": "Amounts in {currency}",
} as const;
