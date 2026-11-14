import { htmlToText, type ItauEmailInput } from "./itau-parser";

export function isItauTransfer(input: ItauEmailInput): boolean {
  return /^[^@\s<>]+@itau\.com\.uy$/i.test(input.from.trim()) &&
    /^aviso(?: de)? transferencia realizada$/i.test(input.subject.trim());
}

/**
 * Destination as Itaú prints it: the bank or institution and the last digits of the account. Itaú itself
 * masks the rest ("Cuenta destino: ******0500") and sends no payee name, so only the bank and the last
 * four digits are kept. The source account is never stored.
 */
function matchDestination(text: string): { bank: string; last4: string } | null {
  // Bounded quantifiers on single-line matches: bodies come from e-mail (untrusted).
  const account = text.match(/cuenta destino:\s{0,3}\*{0,16}\s{0,3}(\d{3,12})\b/i);
  const bank = text.match(/banco\/instituci[oó]n destino:\s{0,3}([^\n]{1,60})/i);
  const name = bank?.[1].replace(/\s+/g, " ").trim();
  if (!account || !name) return null;
  return { bank: name, last4: account[1].slice(-4) };
}

/** A transfer notice is evidence of a reported transfer, not proof of settlement. */
export function parseItauTransfer(input: ItauEmailInput) {
  if (!isItauTransfer(input) || !Number.isFinite(input.date.getTime()) || !input.messageId) return null;
  const text = htmlToText(input.html);
  if (!/transferencia realizada desde la cuenta/i.test(text)) return null;
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed decimal suffix separated by a literal dot; quantifiers bounded so long digit runs cannot backtrack.
  const match = text.match(/importe:\s{0,3}([0-9]{1,15}(?:\.[0-9]{1,2})?)\s{1,3}(URGP|US\.D|UYU|USD)\b/i);
  if (!match) return null;
  const codes: Record<string, string> = { URGP: "UYU", "US.D": "USD", UYU: "UYU", USD: "USD" };
  const currencyCode = codes[match[2].toUpperCase()];
  if (!currencyCode) return null;
  const destination = matchDestination(text);
  const to = destination ? ` · ${destination.bank} ***${destination.last4}` : "";
  return { messageId: input.messageId, txnDateIso: input.date.toISOString(), merchant: "Transferencia enviada", amountRaw: match[1], currencyCode, cardNetwork: null, cardLast4: null, paymentMethod: null, isRefund: false, counterpartyBank: destination?.bank ?? null, counterpartyLast4: destination?.last4 ?? null, rawExcerpt: `${match[1]} ${currencyCode} · Transferencia enviada${to}`, kind: "transfer_out" as const };
}
