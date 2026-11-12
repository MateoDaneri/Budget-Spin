import { splitwiseCredential } from "./credential";
import { getSplitwiseActivityAndBalances, getSplitwiseSnapshot, splitwiseTime, SplitwiseSyncLimitError, type SplitwiseSnapshot } from "./client";
import { saveSplitwiseActivity } from "./activity-store";
import { getSplitwiseSyncState, saveSplitwiseSnapshot, type SplitwiseSyncState } from "./store";

/** A full pass re-reads the whole history at least this often to catch what incremental filters miss. */
export const FULL_RECONCILIATION_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-read this much before the watermark: tolerates clock skew and same-second updates (upserts are idempotent). */
export const WATERMARK_OVERLAP_MS = 5 * 60 * 1000;

export type SplitwiseSyncPlan = { mode: "full" } | { mode: "incremental"; updatedAfter: string };

/** Full pass without a committed watermark or a recent full pass; otherwise only changes since the watermark. */
export function planSplitwiseSync(state: SplitwiseSyncState | null, nowMs: number): SplitwiseSyncPlan {
  if (!state?.watermark || !state.fullSyncedAt) return { mode: "full" };
  const fullAt = Date.parse(state.fullSyncedAt);
  const watermark = Date.parse(state.watermark);
  if (Number.isNaN(fullAt) || Number.isNaN(watermark) || nowMs - fullAt >= FULL_RECONCILIATION_MS) return { mode: "full" };
  return { mode: "incremental", updatedAfter: splitwiseTime(watermark - WATERMARK_OVERLAP_MS) };
}

export async function syncSplitwise(options: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<void> {
  const now = options.now ?? Date.now;
  const token = await splitwiseCredential();
  const startedAt = new Date(now()).toISOString();
  const plan = planSplitwiseSync(getSplitwiseSyncState(), now());
  let snapshot: SplitwiseSnapshot;
  try {
    snapshot = await getSplitwiseSnapshot(token, options.fetcher, { now, updatedAfter: plan.mode === "incremental" ? plan.updatedAfter : undefined });
  } catch (error) {
    // Fixed text only: the route hides failures, so this is the operator's signal for a bounded stop.
    if (error instanceof SplitwiseSyncLimitError) console.warn(`[splitwise-sync] ${plan.mode} pass stopped (${error.reason}); nothing saved, watermark unchanged.`);
    throw error;
  }
  saveSplitwiseSnapshot(snapshot.accountId, snapshot.expenses, { mode: plan.mode, startedAt, watermark: snapshot.watermark });
  const activity = await getSplitwiseActivityAndBalances(token, options.fetcher);
  saveSplitwiseActivity(snapshot.accountId, activity.balances, activity.events);
}
