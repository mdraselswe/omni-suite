// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sign = (body: string, secret: string, t: number) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("stripe client helpers", () => {
  it("encodes nested params the way Stripe expects and drops empty values", async () => {
    const { encodeForm } = await import("./stripe");
    expect(
      encodeForm({
        mode: "payment",
        customer_email: "",
        metadata: { invoiceId: "a" },
        line_items: [{ quantity: 1, price_data: { unit_amount: "1500" } }],
        skip: undefined,
      }),
    ).toEqual([
      ["mode", "payment"],
      ["metadata[invoiceId]", "a"],
      ["line_items[0][quantity]", "1"],
      ["line_items[0][price_data][unit_amount]", "1500"],
    ]);
  });

  it("accepts a correctly signed, fresh webhook and rejects everything else", async () => {
    const { verifyWebhook } = await import("./stripe");
    const body = JSON.stringify({ id: "evt_1", type: "x", data: { object: {} } });
    const secret = "whsec_test_secret_value";
    const now = 1_800_000_000;
    expect(verifyWebhook(body, sign(body, secret, now), secret, now)?.id).toBe("evt_1");
    // Extra entries and several v1 signatures (secret rolling) are fine.
    const rolled = `${sign(body, "whsec_old_secret_value", now)},v1=${sign(body, secret, now).split("v1=")[1]},v0=abc`;
    expect(verifyWebhook(body, rolled, secret, now)?.id).toBe("evt_1");
    expect(verifyWebhook(body, sign(body, "whsec_wrong_secret", now), secret, now)).toBeNull();
    expect(verifyWebhook(`${body} `, sign(body, secret, now), secret, now)).toBeNull();
    expect(verifyWebhook(body, sign(body, secret, now - 301), secret, now)).toBeNull();
    expect(verifyWebhook(body, null, secret, now)).toBeNull();
    expect(verifyWebhook(body, "garbage", secret, now)).toBeNull();
  });

  it("tells test keys from live keys", async () => {
    const { keyMode } = await import("./stripe");
    expect(keyMode("sk_test_51Habcdefghijk")).toBe("test");
    expect(keyMode("rk_live_51Habcdefghijk")).toBe("live");
    expect(keyMode("pk_test_51Habcdefghijk")).toBeNull();
    expect(keyMode("sk_test_short")).toBeNull();
  });
});
