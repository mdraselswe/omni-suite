import { describe, expect, it } from "vitest";
import { DEV_SECRETS, insecureSecrets, weakSecrets } from "./env";

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

describe("weakSecrets", () => {
  const key32 = Buffer.alloc(32, 7).toString("base64");
  const strong = {
    APP_URL: "https://app.example.com",
    BETTER_AUTH_SECRET: "x".repeat(32),
    ENCRYPTION_KEY: key32,
    DOMAIN_CHECK_SECRET: "",
  };

  it("accepts long secrets and a 32-byte key", () => {
    expect(weakSecrets(strong, "production")).toEqual([]);
    expect(weakSecrets({ ...strong, DOMAIN_CHECK_SECRET: "d".repeat(40) }, "production")).toEqual([]);
  });

  it("rejects short secrets on a public production server", () => {
    expect(
      weakSecrets(
        { ...strong, BETTER_AUTH_SECRET: "short-secret-16ch", DOMAIN_CHECK_SECRET: "abc" },
        "production",
      ),
    ).toEqual(["BETTER_AUTH_SECRET", "DOMAIN_CHECK_SECRET"]);
    expect(weakSecrets({ ...strong, BETTER_AUTH_SECRET: "short" }, "development")).toEqual([]);
  });

  it("always rejects an encryption key that isn't 32 bytes", () => {
    expect(weakSecrets({ ...strong, ENCRYPTION_KEY: "dG9vLXNob3J0" }, "development")).toEqual([
      "ENCRYPTION_KEY",
    ]);
    expect(weakSecrets({ ...strong, ENCRYPTION_KEY: DEV_SECRETS.ENCRYPTION_KEY }, "test")).toEqual([]);
  });
});
