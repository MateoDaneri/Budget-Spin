// Parser for Itaú Uruguay "Aviso de consumo" notification emails.
//
// Scope: this module does NOT touch IMAP, MIME or the database. It receives an
// already-decoded message (the MIME/quoted-printable work is the mail library's
// job — see src/ingest/imap.ts) and extracts the transaction fields. Keeping it
// pure makes it unit-testable from a static HTML fixture, which is where the real
// risk lives: free-text emails whose wording can change and silently break us.

export type ItauEmailInput = {
  /** UID for locating an unreadable candidate; not a stable identity across UIDVALIDITY changes. */
  uid?: number;
  subject: string;
  from: string;
  /** RFC date header of the email; used as the transaction timestamp. */
  date: Date;
  /** RFC Message-ID header; the idempotency key for dedup. */
  messageId: string;
  /** Decoded HTML body. */
  html: string;
};

/** A recognized notice cannot be interpreted safely with the supported formats. */
export class UnrecognizedNoticeError extends Error {}

export type ParsedItauAviso = {
  messageId: string;
  /** ISO timestamp (UTC) taken from the email Date header. */
  txnDateIso: string;
  /** Merchant string as shown by Itaú, whitespace-normalized. */
  merchant: string;
  /** Amount as written in the email (major units), e.g. "199.0". */
  amountRaw: string;
  /** ISO 4217 code as written in the email, e.g. "UYU" / "USD". */
  currencyCode: string;
  cardNetwork: string | null;
  cardLast4: string | null;
  /** Human-readable one-line summary, stored for audit. */
  rawExcerpt: string;
};

const AVISO_SUBJECT_HINT = "aviso de consumo";

/**
 * Returns the parsed transaction, or null when the message is not an Itaú
 * "aviso de consumo" (wrong sender/subject, or the body shape we don't know).
 * Returning null — never throwing — lets the ingest loop skip unrelated mail
 * without aborting the whole run.
 */
export function parseItauAviso(input: ItauEmailInput): ParsedItauAviso | null {
  if (!isItauAviso(input) || !Number.isFinite(input.date.getTime())) {
    return null;
  }

  const text = htmlToText(input.html);

  const debit = matchDebitNotice(input.subject, text);
  if (/^aviso de consumo aprobado con tarjeta de d[eé]bito$/i.test(input.subject.trim()) && !debit) return null;
  const amount = debit?.amount ?? matchAmount(text);
  const merchant = debit?.merchant ?? matchMerchant(text);
  if (!amount || !merchant) {
    return null;
  }

  const card = matchCard(text);

  return {
    messageId: input.messageId,
    txnDateIso: input.date.toISOString(),
    merchant,
    amountRaw: amount.amountRaw,
    currencyCode: amount.currencyCode,
    cardNetwork: card?.network ?? null,
    cardLast4: card?.last4 ?? null,
    rawExcerpt: `${amount.amountRaw} ${amount.currencyCode} · ${merchant}${card ? ` · ${card.network} ***${card.last4}` : ""}`
  };
}

/** Itaú debit-card purchase notice: amounts use decimal dots and optional comma groups. */
function matchDebitNotice(subject: string, text: string): { amount: { amountRaw: string; currencyCode: string }; merchant: string } | null {
  if (!/^aviso de consumo aprobado con tarjeta de d[eé]bito$/i.test(subject.trim())) return null;
  const line = text.replace(/\s+/g, " ");
  if (!/\bconsumo de su tarjeta\b/i.test(line)) return null;
  // Fixed delimiters and bounded merchant length; do not interpret transfers or unapproved notices.
  // eslint-disable-next-line security/detect-unsafe-regex -- Merchant is explicitly bounded and separated from the fixed amount label.
  const match = line.match(/realizado en\s+(.{1,80}?)\s+monto\s*:\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s+(pesos|d[oó]lares)\b/i);
  if (!match) return null;
  const merchant = match[1].trim();
  if (!merchant) return null;
  return { merchant, amount: { amountRaw: match[2].replace(/,/g, ""), currencyCode: /^pesos$/i.test(match[3]) ? "UYU" : "USD" } };
}

export function isItauAviso(input: ItauEmailInput): boolean {
  const fromOk = /^[^@\s<>]+@itau\.com\.uy$/i.test(input.from.trim());
  const subjectOk = input.subject.toLowerCase().includes(AVISO_SUBJECT_HINT);
  return fromOk && subjectOk;
}

/**
 * Converts the notification HTML into trimmed, line-structured text:
 * block/line-break tags become newlines (so the merchant value never bleeds
 * into the next sentence), remaining inline tags are stripped, and a few HTML
 * entities are decoded. Internal runs of whitespace are collapsed to one space.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|h[1-6]|tr|td|div|table)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function matchAmount(text: string): { amountRaw: string; currencyCode: string } | null {
  // "Importe: 199.0 UYU"  (notification format observed: dot-decimal, no thousands sep)
  const match = text.match(/Importe:\s*([\d.,]+)\s*([A-Za-z]{3})\b/i);
  if (!match) {
    return null;
  }
  return { amountRaw: normalizeAmount(match[1]), currencyCode: match[2].toUpperCase() };
}

/**
 * Normalizes the amount string to a plain dot-decimal accepted by
 * parseMoneyToMinor. Handles the observed format ("199.0") and, defensively,
 * the Uruguayan notation ("1.234,56") in case larger amounts use it — that
 * branch is unverified until we see a sample over 1000 / a USD aviso.
 */
function normalizeAmount(raw: string): string {
  const value = raw.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: groups are separated by a literal '.', no ambiguous alternation, backtracking is linear (same pattern as money.ts)
  if (/^\d+(\.\d+)?$/.test(value)) {
    return value; // already dot-decimal, e.g. "199.0"
  }
  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: each repeated unit is anchored by a literal '.' and a fixed \d{3}, no overlap; backtracking is linear
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) {
    return value.replace(/\./g, "").replace(",", "."); // "1.234,56" -> "1234.56"
  }
  return value.replace(",", "."); // last resort; parseMoneyToMinor will reject if invalid
}

function matchMerchant(text: string): string | null {
  const match = text.match(/Comercio:\s*(.+)/i);
  if (!match) {
    return null;
  }
  const merchant = match[1].replace(/\s+/g, " ").trim();
  return merchant.length > 0 ? merchant : null;
}

function matchCard(text: string): { network: string; last4: string } | null {
  // "VISA nro. ***1234"
  const match = text.match(/([A-Za-z]+)\s+nro\.?\s*\*+\s*(\d{4})/i);
  if (!match) {
    return null;
  }
  return { network: match[1].toUpperCase(), last4: match[2] };
}
