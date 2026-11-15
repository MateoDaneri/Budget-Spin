import { merchantKey } from "./merchant-key";

/**
 * Key that ties a recurring expense to the bank movements that pay it.
 *  - Purchases: the merchant key (same leading words; trailing store/terminal ids ignored),
 *    so "STREAMING EXAMPLE *SUBSCR +1234" matches every monthly charge.
 *  - Transfers: the notice has no payee name, but it has the destination account's last four digits
 *    ("transfer-to:1234:UYU"); a different amount still matches. Without a readable destination the key
 *    falls back to currency + exact amount ("transfer:UYU:150000").
 * Returns null when no stable key exists (a generic description, an incoming transfer).
 */
export type MatchableMovement = {
  kind: "purchase" | "transfer_out" | "transfer_in";
  description: string;
  currencyCode: string;
  amountMinor: number;
  counterpartyBank?: string | null;
  counterpartyLast4?: string | null;
  isBillPayment?: boolean;
};

export function recurringMatchKey(movement: MatchableMovement): string | null {
  if (movement.kind === "transfer_out") {
    // Preferred: the destination account's last four digits and the currency, so a changed amount still
    // matches. The bank name is display-only: Itaú has printed the same bank differently over time
    // ("Itau" vs "Banco Itaú de Uruguay"), which would split one payee into two keys.
    if (movement.counterpartyLast4 && /^\d{3,4}$/.test(movement.counterpartyLast4)) {
      return `transfer-to:${movement.counterpartyLast4}:${movement.currencyCode}`;
    }
    // Fallback for notices without a readable destination: currency + exact amount.
    return Number.isSafeInteger(movement.amountMinor) && movement.amountMinor > 0 ? `transfer:${movement.currencyCode}:${movement.amountMinor}` : null;
  }
  if (movement.kind !== "purchase") return null;
  // Itaú Pagos names only the collection network, shared by many billers: the amount tells them apart.
  if (movement.isBillPayment) {
    const network = merchantKey(movement.description);
    return network && Number.isSafeInteger(movement.amountMinor) && movement.amountMinor > 0 ? `payment:${network}:${movement.currencyCode}:${movement.amountMinor}` : null;
  }
  const key = merchantKey(movement.description);
  return key ? `merchant:${key}` : null;
}
