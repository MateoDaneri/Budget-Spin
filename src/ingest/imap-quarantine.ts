/* eslint-disable security/detect-non-literal-fs-filename -- State paths are controlled by the operator. */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type Item = { uidValidity: string; uid: number };
const MAX_ITEMS = 1000;
export class ImapQuarantine {
  private constructor(private readonly file: string, private items: Item[]) {}
  static async open(mailboxKey: string): Promise<ImapQuarantine> {
    if (!/^[a-f0-9]{64}$/.test(mailboxKey)) throw new Error("Invalid mailbox key.");
    const dir = process.env.ITAU_IMAP_STATE_DIR ?? "/app/data/ingest-state";
    const file = path.join(dir, `imap-quarantine-${mailboxKey}.json`);
    let items: Item[] = [];
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || (stat.mode & 0o077)) throw new Error("Invalid IMAP quarantine permissions.");
      const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (!Array.isArray(value) || value.length > MAX_ITEMS || value.some((x) => !x || typeof x.uidValidity !== "string" || !/^\d+$/.test(x.uidValidity) || !Number.isSafeInteger(x.uid) || x.uid < 1)) throw new Error("Invalid IMAP quarantine.");
      items = value as Item[];
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return new ImapQuarantine(file, items);
  }
  count(): number { return this.items.length; }
  retry(uidValidity: string): number[] { return this.items.filter((item) => item.uidValidity === uidValidity).slice(0, 20).map((item) => item.uid); }
  async finishRetry(uidValidity: string, attempted: number[], completed: number[]): Promise<void> {
    const done = new Set(completed), tried = new Set(attempted);
    const keep = this.items.filter((item) => item.uidValidity !== uidValidity || !done.has(item.uid));
    this.items = [...keep.filter((item) => item.uidValidity !== uidValidity || !tried.has(item.uid)), ...keep.filter((item) => item.uidValidity === uidValidity && tried.has(item.uid))];
    await this.save();
  }
  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(this.items), { mode: 0o600, flag: "wx" }); await fs.rename(temp, this.file); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  async add(uidValidity: string, uid: number): Promise<void> {
    if (!/^\d+$/.test(uidValidity) || !Number.isSafeInteger(uid) || uid < 1) throw new Error("Cannot retain candidate without a valid UID.");
    if (this.items.some((item) => item.uidValidity === uidValidity && item.uid === uid)) return;
    if (this.items.length >= MAX_ITEMS) throw new Error("IMAP quarantine limit reached.");
    this.items.push({ uidValidity, uid });
    await this.save();
  }
}
