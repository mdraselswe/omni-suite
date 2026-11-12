import { billingSchema, type BillingConfig } from "./schema.ts";

/**
 * ✏️ OmniSuite subscription plans (what businesses pay the platform).
 * Prices here are only what the plan card shows: create the matching recurring
 * Prices in Stripe and put their ids in STRIPE_PRICE_STARTER / _GROWTH / _SCALE.
 * Plan names and feature lists are UI text: `plan.<key>.*` in src/i18n/messages/en-payments.ts.
 */
const billing: BillingConfig = {
  stripeApiVersion: "2026-10-28.endive",
  trialDays: 30,
  plans: [
    {
      key: "starter",
      price: { amount: 29, currency: "AUD" },
      maxMembers: 3,
      aiDailyRequests: 20,
      highlighted: false,
    },
    {
      key: "growth",
      price: { amount: 79, currency: "AUD" },
      maxMembers: 15,
      aiDailyRequests: 50,
      highlighted: true,
    },
    {
      key: "scale",
      price: { amount: 199, currency: "AUD" },
      maxMembers: null,
      aiDailyRequests: 150,
      highlighted: false,
    },
  ],
};

export const billingConfig = billingSchema.parse(billing);
