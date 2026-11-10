import { promises as fs } from "node:fs";

export async function triggerToken(): Promise<string | undefined> {
  if (process.env.INGEST_TOKEN) return process.env.INGEST_TOKEN;
  const file = "/app/data/ingest-token";
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Invalid trigger credential permissions.");
    const token = (await fs.readFile(file, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error("Invalid trigger credential.");
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
