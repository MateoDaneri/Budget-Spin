import { htmlToText, type ItauEmailInput } from "./itau-parser";

export function isItauTransfer(input: ItauEmailInput): boolean {
  return /^[^@\s<>]+@itau\.com\.uy$/i.test(input.from.trim()) &&
    /^aviso(?: de)? transferencia realizada$/i.test(input.subject.trim());
}

/** A transfer notice is evidence of a reported transfer, not proof of settlement. */
export function parseItauTransfer(input: ItauEmailInput) {
  if (!isItauTransfer(input) || !Number.isFinite(input.date.getTime()) || !input.messageId) return null;
  const text = htmlToText(input.html);
  if (!/transferencia realizada desde la cuenta/i.test(text)) return null;
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed decimal suffix separated by a literal dot; no overlapping repetition.
  const match = text.match(/importe:\s*([0-9]+(?:\.[0-9]{1,2})?)\s+(URGP|US\.D|UYU|USD)\b/i);
  if (!match) return null;
  const codes: Record<string, string> = { URGP: "UYU", "US.D": "USD", UYU: "UYU", USD: "USD" };
  const currencyCode = codes[match[2].toUpperCase()];
  if (!currencyCode) return null;
  return { messageId: input.messageId, txnDateIso: input.date.toISOString(), merchant: "Transferencia enviada", amountRaw: match[1], currencyCode, cardNetwork: null, cardLast4: null, rawExcerpt: `${match[1]} ${currencyCode} · Transferencia enviada`, kind: "transfer_out" as const };
}
