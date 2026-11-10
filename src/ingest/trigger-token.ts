import { promises as fs } from "node:fs";

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{32,256}$/;
// Former example value: it matches the format, so it must be rejected explicitly.
const KNOWN_PLACEHOLDERS = new Set(["replace-with-a-long-random-token"]);

/** A configured token that fails this check makes the routes fail closed (503). */
export function isValidTriggerToken(token: string): boolean {
  return TOKEN_FORMAT.test(token) && !KNOWN_PLACEHOLDERS.has(token);
}

export async function triggerToken(): Promise<string | undefined> {
  const configured = process.env.INGEST_TOKEN;
  if (configured) {
    // Same rule as the file credential; never fall back to the file when the
    // environment value is invalid, so a misconfiguration is visible.
    if (!isValidTriggerToken(configured)) throw new Error("Invalid trigger credential.");
    return configured;
  }
  const file = "/app/data/ingest-token";
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Invalid trigger credential permissions.");
    const token = (await fs.readFile(file, "utf8")).trim();
    if (!isValidTriggerToken(token)) throw new Error("Invalid trigger credential.");
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
