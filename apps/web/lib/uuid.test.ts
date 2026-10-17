import { describe, expect, it } from "vitest";
import { safeRandomUUID } from "./uuid";

describe("safeRandomUUID", () => {
  it("returns RFC 4122 version 4 identifiers without requiring a secure origin", () => {
    const value = safeRandomUUID();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
