import "server-only";
import { promises as fs } from "node:fs";

/** The file stays in the private application volume; avoid placing its value in container metadata. */
export async function splitwiseCredential(): Promise<string | undefined> {
  if (process.env.SPLITWISE_API_KEY) return process.env.SPLITWISE_API_KEY;
  const file = "/app/data/splitwise-api-key";
  const info = await fs.stat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!info) return undefined;
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Splitwise credential file must be private.");
  const value = (await fs.readFile(file, "utf8")).trim();
  if (!value || /\s/.test(value) || value.length > 8192) throw new Error("Splitwise credential file is invalid.");
  return value;
}
