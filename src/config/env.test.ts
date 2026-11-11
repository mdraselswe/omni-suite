import { describe, expect, it } from "vitest";
import { DEV_SECRETS, insecureSecrets } from "./env";

const live = { APP_URL: "https://app.example.com", ...DEV_SECRETS };

describe("insecureSecrets", () => {
  it("flags public default secrets on a production server", () => {
    expect(insecureSecrets(live, "production")).toEqual(["BETTER_AUTH_SECRET", "ENCRYPTION_KEY"]);
    expect(insecureSecrets({ ...live, ENCRYPTION_KEY: "real" }, "production")).toEqual([
      "BETTER_AUTH_SECRET",
    ]);
    expect(
      insecureSecrets(
        { ...live, BETTER_AUTH_SECRET: "a-real-secret-0123", ENCRYPTION_KEY: "real" },
        "production",
      ),
    ).toEqual([]);
  });

  it("allows the defaults in development, tests and local production runs (e2e)", () => {
    expect(insecureSecrets(live, "development")).toEqual([]);
    expect(insecureSecrets(live, "test")).toEqual([]);
    expect(insecureSecrets({ ...live, APP_URL: "http://localhost:4173" }, "production")).toEqual([]);
  });
});
