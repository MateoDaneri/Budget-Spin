/**
 * Monthly checklist of bills the owner pays by hand. A bill is a template that repeats every month;
 * "paid" is recorded per bill and month. Marking a bill paid never changes the real net or the balance:
 * the money itself is counted by bank notices and adjustments, so counting it here too would subtract it twice.
 */

export type Bill = {
  id: number;
  name: string;
  /** Expected amount in minor units, or null when it varies (e.g. a card statement). */
  amountMinor: number | null;
  currencyCode: string | null;
  /** Day of month the bill is due (1-31), or null. */
  dueDay: number | null;
  isActive: boolean;
  /** ISO timestamp of creation; the bill appears from that month on. */
  createdAt: string;
};

export type BillPayment = { billId: number; month: string; paidAt: string };

export type BillRow = Bill & { paidAt: string | null };

/**
 * Bills shown for a month: active bills created on or before that month, plus removed bills that were
 * paid in it (so history is kept). Ordered by due day (bills without one last), then by name.
 */
export function billsForMonth(month: string, bills: Bill[], payments: BillPayment[]): BillRow[] {
  const paid = new Map(payments.filter((payment) => payment.month === month).map((payment) => [payment.billId, payment.paidAt]));
  return bills
    .filter((bill) => (bill.isActive && bill.createdAt.slice(0, 7) <= month) || paid.has(bill.id))
    .map((bill) => ({ ...bill, paidAt: paid.get(bill.id) ?? null }))
    .sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99) || a.name.localeCompare(b.name, "es") || a.id - b.id);
}
