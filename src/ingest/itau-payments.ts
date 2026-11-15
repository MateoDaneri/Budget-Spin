import { htmlToText, type ItauEmailInput } from "./itau-parser";

const ITAU_SENDER = /^[^@\s<>]+@itau\.com\.uy$/i;

/** "Pago realizado": a bill paid through Itaú Pagos. The payee is the collection network (e.g. SISTARBANC), not the biller. */
export function isItauBillPayment(input: Pick<ItauEmailInput, "from" | "subject">): boolean {
  return ITAU_SENDER.test(input.from.trim()) && /^pago realizado\.?$/i.test(input.subject.trim());
}

/** "Aviso de pago de tarjeta de crédito": the card statement was paid. The body is an image, so only the date is known. */
export function isItauCardPayment(input: Pick<ItauEmailInput, "from" | "subject">): boolean {
  return ITAU_SENDER.test(input.from.trim()) && /^aviso de pago de tarjeta de cr[eé]dito$/i.test(input.subject.trim());
}

export function parseItauBillPayment(input: ItauEmailInput) {
  if (!isItauBillPayment(input) || !Number.isFinite(input.date.getTime()) || !input.messageId) return null;
  const text = htmlToText(input.html);
  // "Monto: USD 21.37." / "Monto: $ 13.00." — bounded quantifiers; the trailing period is punctuation.
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed decimal suffix separated by a literal dot; bounded quantifiers.
  const amount = text.match(/monto:\s{0,3}(USD|U\$S|UYU|\$)\s{0,3}([0-9]{1,15}(?:\.[0-9]{1,2})?)\.?(?:\s|$)/i);
  const payee = text.match(/pago a\s{1,3}([^\n]{1,60}?)\.?(?:\n|$)/i);
  if (!amount || !payee) return null;
  const currencyCode = /^(USD|U\$S)$/i.test(amount[1]) ? "USD" : "UYU";
  const merchant = payee[1].replace(/\s+/g, " ").trim();
  if (!merchant) return null;
  return {
    messageId: input.messageId,
    txnDateIso: input.date.toISOString(),
    merchant,
    amountRaw: amount[2],
    currencyCode,
    cardNetwork: null,
    cardLast4: null,
    paymentMethod: null,
    isRefund: false,
    counterpartyBank: null,
    counterpartyLast4: null,
    rawExcerpt: `${amount[2]} ${currencyCode} · Pago a ${merchant}`
  };
}
