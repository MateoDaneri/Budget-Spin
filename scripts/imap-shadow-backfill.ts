// Run only against an isolated SQLite copy and an explicitly read-only secret mount.
import { getIngestCursor } from "../src/db/repository";
import { runItauIngest } from "../src/ingest/ingest-itau";
import { mailboxCursorKey, readImapConfigFromEnv } from "../src/ingest/imap";

async function main() {
  if (process.env.DATABASE_PATH !== "/shadow/budgetspin.sqlite" || process.env.ITAU_IMAP_STATE_DIR !== "/shadow/state" || process.env.ITAU_IMAP_CREDENTIALS_PATH !== "/secrets/imap-credentials.json" || process.env.ITAU_INGEST_PROVIDER !== "imap") throw new Error("Isolated configuration required.");
  const config = readImapConfigFromEnv();
  if (!config) throw new Error("IMAP credential unavailable.");
  const key = mailboxCursorKey(config);
  let totalInserted = 0, totalSkipped = 0;
  for (let pass = 0; pass < 300; pass++) {
    const before = getIngestCursor(key);
    const summary = await runItauIngest();
    totalInserted += summary.inserted; totalSkipped += summary.skipped;
    const after = getIngestCursor(key);
    if (!after) throw new Error("Missing checkpoint.");
    if (before && before.uidValidity === after.uidValidity && before.lastUid === after.lastUid) {
      console.log(JSON.stringify({ complete: true, passes: pass + 1, totalInserted, totalSkipped }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Backfill pass limit reached; resumable checkpoint retained.");
}
main().catch(() => { console.error("Shadow backfill stopped; no production database was modified."); process.exitCode = 1; });
