/**
 * ✏️ AI assistant settings. The Claude API key is ANTHROPIC_API_KEY (src/config/env.ts);
 * without it every AI feature is hidden.
 */
export const aiConfig = {
  /** Claude model id (see the Claude API docs for current models). */
  model: "claude-opus-5-5",
  /** Thinking depth and token spend: "low" | "medium" | "high" | "xhigh" | "max". */
  effort: "medium",
  /** Hard cap on one answer's length (tokens). */
  maxTokens: 16000,
  /** Give up on a request after this long (milliseconds). */
  timeoutMs: 90_000,
  /** AI requests each business may make per day (its own timezone). */
  dailyRequestsPerBusiness: 50,
  /** Longest brief a member can type for a proposal draft. */
  briefMaxLength: 2000,
} as const satisfies {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  timeoutMs: number;
  dailyRequestsPerBusiness: number;
  briefMaxLength: number;
};
