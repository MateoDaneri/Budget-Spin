/* eslint-disable security/detect-non-literal-fs-filename -- Test-only temporary files. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readImapConfigFromEnv } from "@/src/ingest/imap";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "imap-credentials-"));
  process.env.ITAU_IMAP_CREDENTIALS_PATH = path.join(dir, "credential");
  delete process.env.ITAU_IMAP_HOST; delete process.env.ITAU_IMAP_USER; delete process.env.ITAU_IMAP_PASSWORD;
});
afterEach(() => { delete process.env.ITAU_IMAP_CREDENTIALS_PATH; rmSync(dir, { recursive: true, force: true }); });
it("requires private permissions and rejects invalid secret formats", () => {
  const file = process.env.ITAU_IMAP_CREDENTIALS_PATH!;
  expect(readImapConfigFromEnv()).toBeNull();
  writeFileSync(file, JSON.stringify({ user: "reader@example.test", password: "example" }), { mode: 0o644 });
  expect(() => readImapConfigFromEnv()).toThrow("private");
  rmSync(file); writeFileSync(file, JSON.stringify({ user: "reader@example.test", password: 42 }), { mode: 0o600 });
  expect(() => readImapConfigFromEnv()).toThrow("Invalid");
  rmSync(file); writeFileSync(file, JSON.stringify({ user: "reader@example.test", password: "example" }), { mode: 0o600 });
  expect(readImapConfigFromEnv()).toMatchObject({ host: "imap.gmail.com", port: 993, user: "reader@example.test", password: "example" });
});
