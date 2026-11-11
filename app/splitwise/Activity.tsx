import { listSplitwiseActivity } from "@/src/splitwise/activity-store";
import styles from "./activity.module.css";

type ActivityData = ReturnType<typeof listSplitwiseActivity>;
type Observation = ActivityData["observations"][number];

function chartValue(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && Number.isSafeInteger(Math.round(n * 100)) ? n : null;
}
function ObservedValues({ entries }: { entries: Observation[] }) {
  return <details className={styles.details}><summary>View all {entries.length} observed values</summary><div className={styles.tableWrap}><table className="table"><thead><tr><th scope="col">Observed at (UTC)</th><th scope="col">Balance</th></tr></thead><tbody>{entries.map((p) => <tr key={p.observedAt}><td>{p.observedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</td><td>{p.currency} {p.amount}</td></tr>)}</tbody></table></div></details>;
}
export function BalanceHistory({ entries }: { entries: Observation[] }) {
  const points = [...entries].reverse().slice(-24);
  const values = points.map((point) => chartValue(point.amount));
  const times = points.map((point) => Date.parse(point.observedAt));
  if (points.length < 2 || values.some((value) => value === null) || times.some((time) => !Number.isFinite(time)) || times[0] === times.at(-1)) return <><p className={styles.empty}>A line will appear after at least two comparable observations. The value above is the latest available observation.</p><ObservedValues entries={entries} /></>;
  const numbers = values as number[];
  const low = Math.min(0, ...numbers), high = Math.max(0, ...numbers), span = high - low || 1;
  const coords = numbers.map((value, i) => ({ x: 34 + (times[i] - times[0]) * 532 / (times.at(-1)! - times[0]), y: 18 + (high - value) / span * 150 }));
  const zero = 18 + high / span * 150;
  return <>
    <p className={styles.chartSummary}>Chart: {points.length} most recent observations, from {points[0].observedAt.slice(0, 10)} to {points.at(-1)!.observedAt.slice(0, 10)}.</p>
    <svg className={styles.chart} viewBox="0 0 600 215" role="img" aria-label={`Observed balance from ${points[0].observedAt.slice(0, 10)} to ${points.at(-1)!.observedAt.slice(0, 10)}. Values are available in the table below.`}>
      <line x1="34" y1={zero} x2="566" y2={zero} className={styles.zero} />
      <text x="34" y="17">{points[0].currency} {high.toLocaleString("en-US", { maximumFractionDigits: 2 })}</text>
      <text x="34" y="188">{points[0].currency} {low.toLocaleString("en-US", { maximumFractionDigits: 2 })}</text>
      <polyline points={coords.map((p) => `${p.x},${p.y}`).join(" ")} className={styles.line} />
      {coords.map((p, i) => <circle key={points[i].observedAt} cx={p.x} cy={p.y} r="3.5" className={styles.point} />)}
      <text x="34" y="210">{points[0].observedAt.slice(0, 10)}</text><text x="566" y="210" textAnchor="end">{points.at(-1)!.observedAt.slice(0, 10)}</text>
    </svg>
    <ObservedValues entries={entries} />
  </>;
}

export function SplitwiseActivity() {
  const data = listSplitwiseActivity();
  const grouped = new Map<string, Observation[]>();
  const people = new Map<number, string>();
  for (const observation of data.observations) {
    const key = `${observation.friendId}:${observation.currency}`;
    const current = grouped.get(key) ?? []; current.push(observation); grouped.set(key, current);
    if (!people.has(observation.friendId)) people.set(observation.friendId, observation.person);
  }
  const label = (type: number, payment: boolean) => {
    const subject = payment ? "Payment" : "Expense";
    return `${subject} ${{ 0: "added", 1: "edited", 2: "deleted", 13: "restored" }[type] ?? "updated"}`;
  };
  return <>
    <section className={`panel ${styles.section}`} aria-labelledby="balance-history-title">
      <div className={styles.heading}><div><h2 id="balance-history-title">Balance history</h2><p>Snapshots recorded by BudgetSpin from Splitwise. Earlier balances are not reconstructed.</p></div>{data.lastObservedAt && <span>Last observed {data.lastObservedAt.slice(0, 10)} UTC</span>}</div>
      {grouped.size === 0 ? <p className={styles.empty}>No balance observations yet. They will appear after the next successful Splitwise sync.</p> : <div className={styles.histories}>{[...grouped.entries()].map(([key, entries]) => <article className={styles.history} key={key}>
        <div className={styles.historyHeader}><h3>{entries[0].person}</h3><strong>{entries[0].currency} {entries[0].amount}</strong></div><p className={styles.caption}>Signed balance reported by Splitwise · {entries[0].currency}. The direction of the sign has not been verified; check Splitwise to see who owes whom.</p>
        <BalanceHistory entries={entries} />
      </article>)}</div>}
      {data.firstObservedAt && <p className={styles.footnote}>Recording began {data.firstObservedAt.slice(0, 10)} UTC. A missing observation does not mean the balance was zero. Showing up to 5,000 recent observations.</p>}
    </section>
    <section className={`panel ${styles.section}`} aria-labelledby="shared-events-title">
      <div className={styles.heading}><div><h2 id="shared-events-title">Activity affecting you</h2><p>Recent Splitwise notifications linked to an expense in which you participate. Earlier events may be missing.</p></div></div>
      {data.events.length === 0 ? <p className={styles.empty}>No linked events have been recorded yet. The next successful sync will check recent notifications.</p> : <ol className={styles.events}>{data.events.map((event) => <li key={event.id}>
        <div><strong>{label(event.type, event.payment)}</strong><p>{event.description}</p><p className={styles.caption}>{event.paid !== null ? `You paid ${event.currency} ${event.paid}` : ""}{event.paid !== null && event.owed !== null ? " · " : ""}{event.owed !== null ? `Your share ${event.currency} ${event.owed}` : ""}</p></div>
        <div className={styles.eventMeta}><time dateTime={event.occurredAt}>{event.occurredAt.slice(0, 10)}</time><span>{event.actorId === data.accountId ? "You" : event.actorId && people.get(event.actorId) ? people.get(event.actorId) : "Participant"}</span></div>
      </li>)}</ol>}
      <p className={styles.footnote}>Event dates come from Splitwise. Expense type, descriptions and amounts reflect the most recently synchronized version, not necessarily the values at the event date. Showing up to 100 saved events.</p>
    </section>
  </>;
}
