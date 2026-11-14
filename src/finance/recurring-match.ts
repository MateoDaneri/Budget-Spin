import { merchantKey } from "./merchant-key";

/**
 * Key that ties a recurring expense to the bank movements that pay it.
 *  - Purchases: the merchant key (same leading words; trailing store/terminal ids ignored),
 *    so "STREAMING EXAMPLE *SUBSCR +1234" matches every monthly charge.
 *  - Transfers: a transfer notice has no payee, so only currency + exact amount can identify it
 *    ("transfer:UYU:150000"). Two different transfers of the same amount share a key; that is a
 *    known limit, accepted because the owner chooses which movement becomes recurring.
 * Returns null when no stable key exists (a generic description, an incoming transfer).
 */
export type MatchableMovement = { kind: "purchase" | "transfer_out" | "transfer_in"; description: string; currencyCode: string; amountMinor: number };

export function recurringMatchKey(movement: MatchableMovement): string | null {
  if (movement.kind === "transfer_out") {
    return Number.isSafeInteger(movement.amountMinor) && movement.amountMinor > 0 ? `transfer:${movement.currencyCode}:${movement.amountMinor}` : null;
  }
  if (movement.kind !== "purchase") return null;
  const key = merchantKey(movement.description);
  return key ? `merchant:${key}` : null;
}
