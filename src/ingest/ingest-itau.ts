import { existsSync, readFileSync, statSync } from "node:fs";
import { getIngestCursor, insertImportedTransaction, listCurrencies, recordIngestRun, saveIngestCursor } from "@/src/db/repository";
import { parseMoneyToMinor } from "@/src/finance/money";
import { fetchQuarantinedMail, fetchRecentMail, mailboxCursorKey, readImapConfigFromEnv, type ImapConfig, type IngestCursor, type MailBatch } from "./imap";
import { isItauAviso, parseItauAviso, UnrecognizedNoticeError, type ItauEmailInput } from "./itau-parser";
import { isItauTransfer, parseItauTransfer } from "./itau-transfer";
import { syncGmail } from "./gmail";
import { ImapQuarantine } from "./imap-quarantine";

export type IngestSummary = { messagesSeen: number; inserted: number; skipped: number };

const SOURCE = "itau_email";

/**
 * Runs one ingest pass: fetch recent mail, keep the Itaú avisos, convert and
 * insert them (deduped by Message-ID), and record the run. The mail fetcher is
 * injectable so the orchestration can be tested without a live IMAP server.
 * Every outcome — including failure — is written to ingest_runs so a watchdog
 * can detect a silently broken parser (no inserts over N days).
 */
export async function runItauIngest(options?: {
  fetcher?: (config: ImapConfig, cursor: IngestCursor | null) => Promise<MailBatch>;
  retryFetcher?: typeof fetchQuarantinedMail;
}): Promise<IngestSummary> {
  let provider = process.env.ITAU_INGEST_PROVIDER;
  if (!provider && existsSync("/app/data/ingest-provider")) {
    const stat = statSync("/app/data/ingest-provider");
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error("Provider selector must be private.");
    provider = readFileSync("/app/data/ingest-provider", "utf8").trim();
    if (provider !== "gmail" && provider !== "imap") throw new Error("Invalid ingest provider.");
  }
  if (provider === "gmail" || (!provider && existsSync("/app/data/gmail-oauth.json"))) return runGmailIngest();
  if (provider && provider !== "imap") throw new Error("Invalid ingest provider.");
  const config = readImapConfigFromEnv();
  if (!config) {
    throw new Error("IMAP is not configured. Set ITAU_IMAP_HOST, ITAU_IMAP_USER and ITAU_IMAP_PASSWORD.");
  }

  const startedAt = new Date().toISOString();
  const fetcher = options?.fetcher ?? fetchRecentMail;

  const cursorKey = mailboxCursorKey(config);
  let messagesSeen = 0;
  let inserted = 0;
  let skipped = 0;
  try {
    const minorUnits = new Map(listCurrencies().map((currency) => [currency.code, currency.minorUnit]));
    const quarantine = await ImapQuarantine.open(cursorKey);
    const previous = getIngestCursor(cursorKey);
    if (previous) {
      const retry = quarantine.retry(previous.uidValidity);
      if (retry.length) {
        const messages = await (options?.retryFetcher ?? fetchQuarantinedMail)(config, previous.uidValidity, retry);
        const completed: number[] = [];
        for (const message of messages) {
          if (message.uid === undefined || !retry.includes(message.uid)) throw new Error("Unexpected retained IMAP notice.");
          try {
            messagesSeen++;
            if (processMessage(message, minorUnits)) inserted++; else skipped++;
            completed.push(message.uid);
          } catch (error) { if (!(error instanceof UnrecognizedNoticeError)) throw error; skipped++; }
        }
        await quarantine.finishRetry(previous.uidValidity, retry, completed);
      }
    }
    // Bounded catch-up: at most 5,000 UID positions per trigger, with each batch
    // committed separately so a later failure never loses an earlier checkpoint.
    for (let window = 0; window < 10; window++) {
      const previous = getIngestCursor(cursorKey);
      const batch = await fetcher(config, previous);
      for (const message of batch.messages) {
        messagesSeen += 1;
        try {
          const result = processMessage(message, minorUnits);
          if (result) inserted += 1;
          else skipped += 1;
        } catch (error) {
          if (!(error instanceof UnrecognizedNoticeError) || message.uid === undefined) throw error;
          // Persist the locator before advancing the cursor; no mail bodies are saved.
          await quarantine.add(batch.cursor.uidValidity, message.uid);
          skipped += 1;
        }
      }
      if (batch.hasMore && previous?.uidValidity === batch.cursor.uidValidity && batch.cursor.lastUid <= previous.lastUid) {
        throw new Error("IMAP cursor did not advance.");
      }
      saveIngestCursor(cursorKey, batch.cursor.uidValidity, batch.cursor.lastUid);
      if (!batch.hasMore) break;
    }
    recordIngestRun({ source: SOURCE, startedAt, messagesSeen, inserted, skipped, status: quarantine.count() ? "error" : "ok", ...(quarantine.count() ? { error: "Unrecognized notices retained for review." } : {}) });
    return { messagesSeen, inserted, skipped };
  } catch (error) {
    // Provider exceptions can contain server-supplied text; never persist it.
    recordIngestRun({ source: SOURCE, startedAt, messagesSeen, inserted, skipped, status: "error", error: "IMAP synchronization failed." });
    throw error;
  }
}

function processMessage(message: ItauEmailInput, minorUnits: Map<string, number>): boolean {
  const transfer = isItauTransfer(message);
  if (!transfer && !isItauAviso(message)) return false;
  const candidateLabel = message.uid === undefined ? "Candidate notification" : `Candidate notification UID ${message.uid}`;
  const aviso = transfer ? parseItauTransfer(message) : parseItauAviso(message);
  if (!aviso || !aviso.messageId) throw new UnrecognizedNoticeError(`${candidateLabel} could not be parsed or has no Message-ID.`);
  const minorUnit = minorUnits.get(aviso.currencyCode);
  if (minorUnit === undefined) throw new Error(`${candidateLabel} has an unconfigured currency.`);
  if ((aviso.amountRaw.split(".")[1] ?? "").length > minorUnit) throw new Error(`${candidateLabel} has unsupported amount precision.`);
  let amountMinor: number;
  try {
    amountMinor = parseMoneyToMinor(aviso.amountRaw, minorUnit);
    if (!Number.isSafeInteger(amountMinor)) throw new Error();
  } catch { throw new Error(`${candidateLabel} has an invalid amount.`); }
  if (amountMinor <= 0) throw new UnrecognizedNoticeError(`${candidateLabel} has a non-positive amount and requires review.`);
  return insertImportedTransaction({
    txnDate: aviso.txnDateIso, description: aviso.merchant, currencyCode: aviso.currencyCode,
    amountMinor, cardNetwork: aviso.cardNetwork, cardLast4: aviso.cardLast4,
    source: SOURCE, messageId: aviso.messageId, rawExcerpt: aviso.rawExcerpt,
    kind: transfer ? "transfer_out" : "purchase", status: "pending"
  }).inserted;
}

async function runGmailIngest(): Promise<IngestSummary> {
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH ?? "/app/data/gmail-oauth.json";
  const statePath = process.env.GMAIL_STATE_PATH ?? "/app/data/ingest-state/gmail-state.json";
  if (!credentialsPath || !statePath) throw new Error("Gmail paths are not configured.");
  const startedAt = new Date().toISOString();
  let messagesSeen = 0, inserted = 0, skipped = 0;
  try {
    const minorUnits = new Map(listCurrencies().map((currency) => [currency.code, currency.minorUnit]));
    const sync = await syncGmail({ credentialsPath, statePath, process: (message) => {
      messagesSeen++;
      if (processMessage(message, minorUnits)) inserted++;
      else skipped++;
    } });
    recordIngestRun({ source: "gmail_api", startedAt, messagesSeen, inserted, skipped, status: sync.quarantined ? "error" : "ok", ...(sync.quarantined ? { error: "Unrecognized notices retained for review." } : {}) });
    return { messagesSeen, inserted, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingest error.";
    recordIngestRun({ source: "gmail_api", startedAt, messagesSeen, inserted, skipped, status: "error", error: message });
    throw error;
  }
}
