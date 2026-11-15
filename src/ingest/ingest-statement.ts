import {
  getIngestCursor,
  insertCardStatement,
  recordIngestRun,
  saveIngestCursor,
  StatementConflictError,
} from "@/src/db/repository";
import { mailboxCursorKey, type ImapConfig, type IngestCursor } from "./imap";
import { ImapQuarantine } from "./imap-quarantine";
import {
  fetchStatementBatch,
  retryStatementMail,
  statementCursorKey,
  type StatementBatch,
  type StatementMail,
} from "./statement-imap";
import { readStatementPdf } from "./statement-pdf";
import type { StatementSummary } from "./itau-statement";

type Options = {
  fetcher?: (
    config: ImapConfig,
    cursor: IngestCursor | null,
  ) => Promise<StatementBatch>;
  retry?: typeof retryStatementMail;
  parse?: (pdf: Uint8Array) => Promise<StatementSummary>;
};
/** Independent historical scan, checkpointed only after durable insert/quarantine. */
export async function runStatementIngest(
  config: ImapConfig,
  options: Options = {},
): Promise<{ inserted: number; quarantined: number }> {
  const key = statementCursorKey(mailboxCursorKey(config)),
    startedAt = new Date().toISOString();
  let inserted = 0,
    seen = 0,
    skipped = 0;
  try {
    const queue = await ImapQuarantine.open(key),
      prior = getIngestCursor(key),
      parse = options.parse ?? readStatementPdf;
    async function process(mail: StatementMail): Promise<boolean> {
      let summary: StatementSummary;
      try {
        summary = await parse(mail.pdf);
      } catch {
        return false;
      }
      try {
        if (insertCardStatement(mail.messageId, summary).inserted) inserted++;
        return true;
      } catch (error) {
        if (error instanceof StatementConflictError) return false;
        throw error;
      }
    }
    if (prior) {
      const ids = queue.retry(prior.uidValidity).slice(0, 5);
      if (ids.length) {
        const available = await (options.retry ?? retryStatementMail)(
            config,
            prior.uidValidity,
            ids,
          ),
          done: number[] = [];
        for (const mail of available) {
          if (!ids.includes(mail.uid)) throw Error("Invalid retry.");
          seen++;
          if (await process(mail)) done.push(mail.uid);
          else skipped++;
        }
        await queue.finishRetry(prior.uidValidity, ids, done);
      }
    }
    let processedThisPass = 0;
    for (let window = 0; window < 10; window++) {
      const before = getIngestCursor(key),
        batch = await (options.fetcher ?? fetchStatementBatch)(config, before);
      processedThisPass += batch.rejected.length + batch.messages.length;
      for (const uid of batch.rejected) {
        seen++;
        skipped++;
        await queue.add(batch.cursor.uidValidity, uid, "unrecognized");
      }
      for (const mail of batch.messages) {
        seen++;
        if (!(await process(mail))) {
          skipped++;
          await queue.add(batch.cursor.uidValidity, mail.uid, "unrecognized");
        }
      }
      if (
        batch.hasMore &&
        before?.uidValidity === batch.cursor.uidValidity &&
        batch.cursor.lastUid <= before.lastUid
      )
        throw Error("Statement cursor did not advance.");
      saveIngestCursor(key, batch.cursor.uidValidity, batch.cursor.lastUid);
      if (!batch.hasMore || processedThisPass >= 5) break;
    }
    recordIngestRun({
      source: "itau_statement",
      startedAt,
      messagesSeen: seen,
      inserted,
      skipped,
      status: queue.count() ? "error" : "ok",
      ...(queue.count() ? { error: "Statements retained for review." } : {}),
    });
    return { inserted, quarantined: queue.count() };
  } catch (error) {
    recordIngestRun({
      source: "itau_statement",
      startedAt,
      messagesSeen: seen,
      inserted,
      skipped,
      status: "error",
      error: "Statement synchronization failed.",
    });
    throw error;
  }
}
