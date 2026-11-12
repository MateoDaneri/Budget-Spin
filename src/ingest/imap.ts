/* eslint-disable security/detect-non-literal-fs-filename -- Credential path is local operator configuration. */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { isItauAviso, type ItauEmailInput, type QuarantineReason } from "./itau-parser";
import { isItauTransfer } from "./itau-transfer";
import { authenticationResultsValues } from "./sender-auth";

export type ImapConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  sinceDays: number;
};

export type IngestCursor = { uidValidity: string; lastUid: number };
/** A candidate that could not be downloaded safely; only its locator and a fixed reason. */
export type RejectedCandidate = { uid: number; reason: Extract<QuarantineReason, "oversized" | "incomplete"> };
export type MailBatch = { messages: ItauEmailInput[]; cursor: IngestCursor; hasMore: boolean; rejected?: RejectedCandidate[] };
export const UID_WINDOW = 500;
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export function readImapConfigFromEnv(): ImapConfig | null {
  let fileConfig: { user?: unknown; password?: unknown } = {};
  const file = process.env.ITAU_IMAP_CREDENTIALS_PATH ?? "/app/data/imap-credentials.json";
  try {
    const stat = statSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("IMAP credential file must be private.");
    fileConfig = JSON.parse(readFileSync(file, "utf8"));
    if (typeof fileConfig.user !== "string" || typeof fileConfig.password !== "string") throw new Error("Invalid IMAP credential file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const host = process.env.ITAU_IMAP_HOST ?? (fileConfig.user ? "imap.gmail.com" : undefined);
  const user = process.env.ITAU_IMAP_USER ?? fileConfig.user;
  const password = process.env.ITAU_IMAP_PASSWORD ?? fileConfig.password;
  if (!host || typeof user !== "string" || !user || typeof password !== "string" || !password) return null;
  const port = Number(process.env.ITAU_IMAP_PORT ?? 993);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid IMAP port.");
  return { host, port, user, password, mailbox: process.env.ITAU_IMAP_MAILBOX ?? "INBOX", sinceDays: 0 };
}

/** Hash only mailbox identity, never its password. A changed account starts a new cursor. */
export function mailboxCursorKey(config: ImapConfig): string {
  return createHash("sha256").update(JSON.stringify([config.host.toLowerCase(), config.port, config.user, config.mailbox])).digest("hex");
}

/** Read one bounded UID window. Caller persists the returned cursor only after processing. */
export async function fetchRecentMail(config: ImapConfig, previous: IngestCursor | null): Promise<MailBatch> {
  const client = new ImapFlow({
    host: config.host, port: config.port, secure: true,
    auth: { user: config.user, pass: config.password }, logger: false
  });
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen(config.mailbox, { readOnly: true });
    const uidValidity = mailbox.uidValidity?.toString();
    const nextUid = mailbox.uidNext;
    if (!uidValidity || !Number.isSafeInteger(nextUid) || nextUid < 1) throw new Error("IMAP mailbox UID state unavailable.");
    const lastUid = previous?.uidValidity === uidValidity ? previous.lastUid : 0;
    if (!Number.isSafeInteger(lastUid) || lastUid < 0 || lastUid >= nextUid) throw new Error("IMAP cursor is inconsistent with mailbox.");
    const endUid = Math.min(lastUid + UID_WINDOW, nextUid - 1);
    const messages: ItauEmailInput[] = [];
    const rejected: RejectedCandidate[] = [];
    if (endUid > lastUid) {
      // Complete the metadata fetch before asking for message bodies: IMAPFlow
      // cannot run another command while a fetch iterator is still active.
      const candidates: number[] = [];
      for await (const message of client.fetch(`${lastUid + 1}:${endUid}`, {
        uid: true, headers: ["from", "subject"]
      }, { uid: true })) {
        if (!message.headers) throw new Error(`IMAP UID ${message.uid} headers missing.`);
        const header = await simpleParser(Buffer.concat([message.headers, Buffer.from("\r\n")]));
        const candidate: ItauEmailInput = {
          uid: message.uid, subject: header.subject ?? "",
          from: header.from?.value.length === 1 ? (header.from.value[0].address ?? "") : "",
          date: new Date(NaN), messageId: "", html: ""
        };
        if (isItauAviso(candidate) || isItauTransfer(candidate)) candidates.push(message.uid);
      }
      for (const uid of candidates) {
        const message = await client.fetchOne(String(uid), {
          uid: true, size: true, source: { start: 0, maxLength: MAX_MESSAGE_BYTES + 1 }
        }, { uid: true });
        // A bad candidate is a property of that one message: report its UID for
        // quarantine instead of failing the window, so the cursor can advance.
        if (message && message.size !== undefined && message.size > MAX_MESSAGE_BYTES) {
          rejected.push({ uid, reason: "oversized" });
          continue;
        }
        if (!message || !message.source || message.size === undefined || message.source.length !== message.size) {
          rejected.push({ uid, reason: "incomplete" });
          continue;
        }
        const parsed = await simpleParser(message.source);
        messages.push({
          uid: message.uid,
          subject: parsed.subject ?? "",
          from: parsed.from?.value.length === 1 ? (parsed.from.value[0].address ?? "") : "",
          date: parsed.date ?? new Date(NaN),
          messageId: parsed.messageId ?? "",
          html: typeof parsed.html === "string" ? parsed.html : (parsed.textAsHtml ?? ""),
          // Raw header lines keep message order and every instance (topmost first).
          authenticationResults: authenticationResultsValues(parsed.headerLines)
        });
      }
    }
    return { messages, rejected, cursor: { uidValidity, lastUid: endUid }, hasMore: endUid < nextUid - 1 };
  } finally {
    await client.logout();
  }
}

/** Retry retained UID locators only while the mailbox identity is unchanged. */
export async function fetchQuarantinedMail(config: ImapConfig, uidValidity: string, uids: number[]): Promise<ItauEmailInput[]> {
  if (!uids.length) return [];
  const client = new ImapFlow({ host: config.host, port: config.port, secure: true, auth: { user: config.user, pass: config.password }, logger: false });
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen(config.mailbox, { readOnly: true });
    if (mailbox.uidValidity?.toString() !== uidValidity) return [];
    const result: ItauEmailInput[] = [];
    for (const uid of uids) {
      const message = await client.fetchOne(String(uid), { uid: true, size: true, source: { start: 0, maxLength: MAX_MESSAGE_BYTES + 1 } }, { uid: true });
      if (!message) continue; // Archived or deleted messages remain in quarantine.
      // Still too large or incomplete: leave it retained and keep retrying the others.
      if (!message.source || message.size === undefined || message.size > MAX_MESSAGE_BYTES || message.source.length !== message.size) continue;
      const parsed = await simpleParser(message.source);
      result.push({ uid: message.uid, subject: parsed.subject ?? "", from: parsed.from?.value.length === 1 ? (parsed.from.value[0].address ?? "") : "", date: parsed.date ?? new Date(NaN), messageId: parsed.messageId ?? "", html: typeof parsed.html === "string" ? parsed.html : (parsed.textAsHtml ?? ""), authenticationResults: authenticationResultsValues(parsed.headerLines) });
    }
    return result;
  } finally { await client.logout(); }
}
