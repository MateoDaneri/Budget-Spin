import { reviewTransactionAction } from "@/src/actions/transactions";
import { latestItauIngestRun, listCategories, listCurrencies, listTransactions } from "@/src/db/repository";
import { ImportCategory } from "@/app/components/ImportCategory";
import { formatMoney } from "@/src/finance/money";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ error?: string }> };

// Only fixed text is shown: the query value selects a message, it is never rendered itself.
const ERROR_MESSAGES: Record<string, string> = {
  "Invalid review decision.": "That review could not be applied. Please try again.",
  "Could not save the review.": "Could not save the review. Please try again.",
  "Invalid category.": "That category could not be applied. Please try again.",
  "Could not save category.": "Could not save the category. Please try again."
};
const GENERIC_ERROR = "Something went wrong. Please try again.";

// MEJ-002 observation mode: shown only; never changes review or totals. Legacy NULL and "pass" show nothing.
const SENDER_AUTH_LABELS: Record<string, string> = { fail: "Sender check failed", none: "Sender unverified" };

function errorMessage(code?: string) {
  if (!code) return null;
  return Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : GENERIC_ERROR;
}

export default async function TransactionsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const transactions = listTransactions();
  const latestRun = latestItauIngestRun();
  const categories = listCategories("expense");
  const currencies = new Map(listCurrencies().map((currency) => [currency.code, currency]));
  const error = errorMessage(params.error);
  const unverifiedPending = transactions.filter((transaction) => transaction.status === "pending" && (transaction.senderAuth === "fail" || transaction.senderAuth === "none")).length;

  return (
    <>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Imported activity</span>
          <h1>Transactions</h1>
        </div>
        {unverifiedPending > 0 ? <span className="status-pill status-warning">{unverifiedPending} pending unverified</span> : null}
      </section>
      {error ? <div className="alert" role="alert">{error}</div> : null}
      <section className="activity-overview" aria-label="Import overview">
        <div><span className="activity-icon" aria-hidden="true">↔</span><span><small>Import status</small><strong>{latestRun ? latestRun.status === "ok" ? "Last check completed" : "Last check failed" : "No checks yet"}</strong><small>{latestRun ? `${latestRun.finishedAt ?? "—"} · ${latestRun.inserted} imported` : "—"}</small></span></div>
        <div><span><small>Recent imports</small><strong>{transactions.length}</strong><small>Last 200</small></span></div>
        <div><span><small>Pending review</small><strong>{transactions.filter((transaction) => transaction.status === "pending").length}</strong><small>To confirm</small></span></div>
      </section>
      <section className="panel activity-list">
        <div className="panel-header">
          <h2>Recent imports</h2>
        </div>
        {transactions.length === 0 ? <p className="muted">No imported transactions yet.</p> : (
          <>
          <div className="transaction-cards">
            {transactions.map((transaction) => {
              const currency = currencies.get(transaction.currencyCode);
              const amount = currency ? formatMoney(transaction.amountMinor, currency) : `${transaction.currencyCode} ${transaction.amountMinor}`;
              const kind = transaction.kind === "purchase" ? "Purchase" : transaction.kind === "transfer_out" ? "Transfer sent" : "Transfer received";
              return (
                <article className="transaction-card" key={transaction.id}>
                  <div className="transaction-card-top">
                    <div>
                      <strong>{transaction.description}</strong>
                      <span>
                        {kind} · <time dateTime={transaction.txnDate}>{transaction.txnDate.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time>
                        {transaction.cardNetwork || transaction.cardLast4 ? <> · {transaction.cardNetwork ?? "Card"}{transaction.cardLast4 ? ` ***${transaction.cardLast4}` : ""}</> : null}
                      </span>
                    </div>
                    <strong>{amount}</strong>
                  </div>
                  <div className="transaction-card-bottom">
                    <span className="status-pill status-muted">{transaction.status}</span>
                    {transaction.senderAuth && Object.hasOwn(SENDER_AUTH_LABELS, transaction.senderAuth) ? <span className="status-pill status-warning">{SENDER_AUTH_LABELS[transaction.senderAuth]}</span> : null}
                    {transaction.kind === "purchase" ? <ImportCategory source="transaction" id={transaction.id} categoryId={transaction.categoryId} categories={categories} /> : null}
                    <TransactionActions transaction={transaction} />
                  </div>
                </article>
              );
            })}
          </div>
          </>
        )}
      </section>
    </>
  );
}

function TransactionActions({ transaction }: { transaction: ReturnType<typeof listTransactions>[number] }) {
  return (
    <form action={reviewTransactionAction} className="inline-actions">
      <input type="hidden" name="id" value={transaction.id} />
      {transaction.status !== "confirmed" ? <button className="button button-secondary" type="submit" name="decision" value="confirmed" aria-label={`Confirm ${transaction.description}`}>Confirm</button> : null}
      {transaction.status !== "discarded" ? <button className="button button-danger" type="submit" name="decision" value="discarded" aria-label={`Discard ${transaction.description}`}>Discard</button> : null}
    </form>
  );
}
