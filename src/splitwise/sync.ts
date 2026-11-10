import { splitwiseCredential } from "./credential";
import { getSplitwiseActivityAndBalances, getSplitwiseSnapshot } from "./client";
import { saveSplitwiseActivity } from "./activity-store";
import { saveSplitwiseSnapshot } from "./store";

export async function syncSplitwise(): Promise<void> {
  const token = await splitwiseCredential();
  const snapshot = await getSplitwiseSnapshot(token);
  saveSplitwiseSnapshot(snapshot.accountId, snapshot.expenses);
  const activity = await getSplitwiseActivityAndBalances(token);
  saveSplitwiseActivity(snapshot.accountId, activity.balances, activity.events);
}
