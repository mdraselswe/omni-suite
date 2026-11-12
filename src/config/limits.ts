import { limitsSchema, type LimitsConfig } from "./schema.ts";

/** ✏️ Abuse limits (mail quotas, storage quota, sign-in throttle). AI limits: src/config/ai.ts. */
const limits: LimitsConfig = {
  mail: { perBusinessPerHour: 100, perBusinessPerDay: 500, perRecipientPerHour: 5 },
  storage: { perBusinessMb: 5120 },
  signIn: { perEmailMax: 10, perEmailWindowMinutes: 15 },
};

export const limitsConfig = limitsSchema.parse(limits);
