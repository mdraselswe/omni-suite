import { describe, expect, it } from "vitest";
import { randomToken, slugify, uuidv7 } from "./ids";

describe("ids", () => {
  it("creates sortable v7 uuids", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it("creates url-safe tokens", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("slugifies names", () => {
    expect(slugify("OmniScope Digital!")).toBe("omniscope-digital");
    expect(slugify("  Café  Déjà ")).toBe("cafe-deja");
  });
});
