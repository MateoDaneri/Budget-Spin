import { getDb } from "@/src/db/client";
import { migrate } from "@/src/db/repository";
import type { SplitwiseActivity, SplitwiseObservedBalance } from "./client";

type Observation = { friendId: number; person: string; currency: string; amount: string; observedAt: string };
type Event = { id: number; type: number; occurredAt: string; observedAt: string; actorId: number | null; expenseId: number; description: string; currency: string; paid: string | null; owed: string | null; payment: boolean };

/** A snapshot records exactly what the provider returned at observation time. */
export function saveSplitwiseActivity(accountId: number, balances: SplitwiseObservedBalance[], events: SplitwiseActivity[], observedAt = new Date().toISOString()): void {
  migrate();
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const account = db.prepare("SELECT account_id FROM splitwise_sync_account WHERE singleton=1").get() as { account_id: number } | undefined;
    if (!account || account.account_id !== accountId) throw new Error("Splitwise account mismatch.");
    const addBalance = db.prepare("INSERT INTO splitwise_balance_observations (account_id,observed_at,friend_id,person,currency,amount) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING");
    for (const balance of balances) addBalance.run(accountId, observedAt, balance.friendId, balance.person, balance.currency, balance.amount);
    // Only persist activity linked to an imported expense in which this account participates.
    const addEvent = db.prepare(`INSERT OR IGNORE INTO splitwise_activity_events (account_id,event_id,occurred_at,observed_at,event_type,expense_id,actor_id)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM splitwise_imports WHERE account_id=? AND expense_id=? AND (paid IS NOT NULL OR owed IS NOT NULL))`);
    for (const event of events) addEvent.run(accountId, event.id, event.occurredAt, observedAt, event.type, event.expenseId, event.actorId, accountId, event.expenseId);
    db.prepare(`INSERT INTO splitwise_activity_sync (account_id,first_observed_at,last_observed_at) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET last_observed_at=excluded.last_observed_at`).run(accountId, observedAt, observedAt);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listSplitwiseActivity(): { accountId: number | null; firstObservedAt: string | null; lastObservedAt: string | null; observations: Observation[]; events: Event[] } {
  migrate();
  const db = getDb();
  const account = db.prepare("SELECT account_id FROM splitwise_sync_account WHERE singleton=1").get() as { account_id: number } | undefined;
  if (!account) return { accountId: null, firstObservedAt: null, lastObservedAt: null, observations: [], events: [] };
  const sync = db.prepare("SELECT first_observed_at,last_observed_at FROM splitwise_activity_sync WHERE account_id=?").get(account.account_id) as { first_observed_at: string; last_observed_at: string } | undefined;
  const observations = db.prepare(`SELECT friend_id AS friendId,person,currency,amount,observed_at AS observedAt FROM splitwise_balance_observations
    WHERE account_id=? ORDER BY observed_at DESC LIMIT 5000`).all(account.account_id) as Observation[];
  const events = db.prepare(`SELECT e.event_id AS id,e.event_type AS type,e.occurred_at AS occurredAt,e.observed_at AS observedAt,
    e.actor_id AS actorId,e.expense_id AS expenseId,i.description,i.currency,i.paid,i.owed,i.payment FROM splitwise_activity_events e
    JOIN splitwise_imports i ON i.account_id=e.account_id AND i.expense_id=e.expense_id
    WHERE e.account_id=? ORDER BY e.occurred_at DESC,e.event_id DESC LIMIT 100`).all(account.account_id) as Array<Omit<Event, "payment"> & { payment: number }>;
  return { accountId: account.account_id, firstObservedAt: sync?.first_observed_at ?? null, lastObservedAt: sync?.last_observed_at ?? null, observations, events: events.map((e) => ({ ...e, payment: Boolean(e.payment) })) };
}
