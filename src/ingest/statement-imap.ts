import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";
import { isItauStatement } from "./itau-statement";
import type { ImapConfig, IngestCursor } from "./imap";
export const MAX_STATEMENT_MESSAGE_BYTES = 8 * 1024 * 1024;
export const MAX_STATEMENT_PDF_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATES = 5;
export type StatementMail = { uid: number; messageId: string; pdf: Buffer };
export type StatementBatch = {
  messages: StatementMail[];
  rejected: number[];
  cursor: IngestCursor;
  hasMore: boolean;
};
export function statementCursorKey(mailboxKey: string): string {
  return createHash("sha256")
    .update(`visa-statement:${mailboxKey}`)
    .digest("hex");
}
function connect(config: ImapConfig) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
}
async function readCandidate(
  client: ImapFlow,
  uid: number,
): Promise<StatementMail | null> {
  const m = await client.fetchOne(
    String(uid),
    {
      uid: true,
      size: true,
      source: { start: 0, maxLength: MAX_STATEMENT_MESSAGE_BYTES + 1 },
    },
    { uid: true },
  );
  if (
    !m ||
    m.uid !== uid ||
    !m.source ||
    m.size === undefined ||
    m.size > MAX_STATEMENT_MESSAGE_BYTES ||
    m.source.length !== m.size
  )
    return null;
  try {
    const mail = await simpleParser(m.source, {
      skipHtmlToText: true,
      skipTextToHtml: true,
    });
    const from =
      mail.from?.value.length === 1 ? (mail.from.value[0].address ?? "") : "";
    const pdf = mail.attachments.filter(
      (a) => a.contentType.toLowerCase() === "application/pdf",
    );
    if (
      !isItauStatement({ from, subject: mail.subject ?? "" }) ||
      !mail.messageId ||
      mail.messageId.length > 998 ||
      /[\r\n]/.test(mail.messageId) ||
      pdf.length !== 1 ||
      pdf[0].content.length > MAX_STATEMENT_PDF_BYTES ||
      !pdf[0].content.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      return null;
    return { uid, messageId: mail.messageId, pdf: pdf[0].content };
  } catch {
    return null;
  }
}
/** Independent cursor: adding statements never rewinds purchase ingest. */
export async function fetchStatementBatch(
  config: ImapConfig,
  previous: IngestCursor | null,
): Promise<StatementBatch> {
  const client = connect(config);
  await client.connect();
  try {
    const box = await client.mailboxOpen(config.mailbox, { readOnly: true });
    const validity = box.uidValidity?.toString(),
      next = box.uidNext;
    if (!validity || !Number.isSafeInteger(next) || next < 1)
      throw Error("Mailbox state unavailable.");
    const last = previous?.uidValidity === validity ? previous.lastUid : 0;
    if (!Number.isSafeInteger(last) || last < 0 || last >= next)
      throw Error("Invalid mailbox cursor.");
    let end = Math.min(last + 5000, next - 1);
    const candidates: number[] = [],
      messages: StatementMail[] = [],
      rejected: number[] = [];
    if (end > last) {
      const seen = new Set<number>();
      for await (const m of client.fetch(
        `${last + 1}:${end}`,
        { uid: true, headers: ["from", "subject"] },
        { uid: true },
      )) {
        if (!Number.isSafeInteger(m.uid) || m.uid <= last || m.uid > end || seen.has(m.uid) || !m.headers || m.headers.length > 65536) {
          throw Error("Invalid statement metadata.");
        }
        seen.add(m.uid);
        const h = await simpleParser(
          Buffer.concat([m.headers, Buffer.from("\r\n")]),
        );
        if (
          isItauStatement({
            from:
              h.from?.value.length === 1 ? (h.from.value[0].address ?? "") : "",
            subject: h.subject ?? "",
          })
        )
          candidates.push(m.uid);
      }
      candidates.sort((a, b) => a - b);
      if (candidates.length > MAX_CANDIDATES)
        end = candidates[MAX_CANDIDATES] - 1;
      for (const uid of candidates.slice(0, MAX_CANDIDATES)) {
        const m = await readCandidate(client, uid);
        if (m) messages.push(m);
        else rejected.push(uid);
      }
    }
    return {
      messages,
      rejected,
      cursor: { uidValidity: validity, lastUid: end },
      hasMore: end < next - 1,
    };
  } finally {
    await client.logout();
  }
}
export async function retryStatementMail(
  config: ImapConfig,
  validity: string,
  uids: number[],
): Promise<StatementMail[]> {
  if (!uids.length) return [];
  const client = connect(config);
  await client.connect();
  try {
    const box = await client.mailboxOpen(config.mailbox, { readOnly: true });
    if (box.uidValidity?.toString() !== validity) return [];
    const result: StatementMail[] = [];
    for (const uid of uids.slice(0, MAX_CANDIDATES)) {
      const mail = await readCandidate(client, uid);
      if (mail) result.push(mail);
    }
    return result;
  } finally {
    await client.logout();
  }
}
