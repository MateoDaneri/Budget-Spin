import { afterEach, describe, expect, it } from "vitest";
import { isValidTriggerToken, triggerToken } from "@/src/ingest/trigger-token";

afterEach(() => { delete process.env.INGEST_TOKEN; });

describe("ingest trigger token", () => {
  it("rejects the example placeholder from the environment", async () => {
    process.env.INGEST_TOKEN = "replace-with-a-long-random-token";
    await expect(triggerToken()).rejects.toThrow("Invalid trigger credential.");
  });

  it("rejects a short environment token", async () => {
    process.env.INGEST_TOKEN = "too-short-token";
    await expect(triggerToken()).rejects.toThrow("Invalid trigger credential.");
  });

  it("rejects characters outside the accepted set", () => {
    expect(isValidTriggerToken("synthetic token with spaces 0123456789")).toBe(false);
    expect(isValidTriggerToken("<generate-with-openssl-rand-base64-48>")).toBe(false);
  });

  it("accepts a well-formed environment token", async () => {
    const token = "Synthetic_Token-0123456789abcdefghijklmnop";
    process.env.INGEST_TOKEN = token;
    await expect(triggerToken()).resolves.toBe(token);
  });
});
