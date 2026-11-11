import { SplitwiseActivity } from "./Activity";
import { ImportCategory } from "@/app/components/ImportCategory";
import { listCategories } from "@/src/db/repository";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { getSplitwiseBalances, SplitwiseError, type SplitwiseBalance } from "@/src/splitwise/client";
import { splitwiseCredential } from "@/src/splitwise/credential";
import { listSplitwiseImports } from "@/src/splitwise/store";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ error?: string }> };

export default async function SplitwisePage({ searchParams }: Props) {
  if (!await getCurrentSession()) redirect("/login");
  // The query value only signals that saving failed; its text is never rendered.
  const saveFailed = Boolean((searchParams ? await searchParams : {}).error);
  const { expenses, syncedAt } = listSplitwiseImports();
  const categories = listCategories("expense");
  let balances: SplitwiseBalance[] = [];
  let error: string | null = null;
  try {
    balances = await getSplitwiseBalances(await splitwiseCredential());
  } catch (caught) {
    const kind = caught instanceof SplitwiseError ? caught.kind : "unavailable";
    error = ({ unconfigured: "Splitwise is not configured.", unauthorized: "Splitwise rejected the credential or access.", "rate-limit": "Splitwise is limiting requests. Try again later.", unavailable: "Could not load Splitwise data. Try again later." })[kind];
  }
  return (
    <>
      <section className="page-hero"><div><span className="eyebrow">Shared spending</span><h1>Splitwise</h1><p className="muted">Recent shared expenses and balances, separate from your recurring plan.</p></div></section>
      {saveFailed ? <div className="alert" role="alert">Could not save the category. Please try again.</div> : null}
      {error ? <div className="alert" role="alert">{error}</div> : (
        <section className="panel shared-balances">
          <h2>Balances by person and currency</h2>
          <p className="muted">Signed amounts reported by Splitwise. Balances are separate from budget cash flow.</p>
          {balances.length === 0 ? <p className="muted">No balances returned.</p> : <ul className="balance-grid">{balances.map((balance, index) => <li key={index}><span>{balance.person}</span><strong>{balance.currency} {balance.amount}</strong></li>)}</ul>}
        </section>
      )}
        <SplitwiseActivity />
        <section className="panel shared-activity">
          <h2>Recent activity</h2>
          <p className="muted">Paid and owed refer to your share. Eligible expenses appear in observed spending; payments and deleted entries do not. Showing up to 200 entries.</p>
          <p className="muted">{syncedAt ? `Last successful sync: ${syncedAt}` : "No successful synchronization yet."}</p>
          {expenses.length === 0 ? <p className="muted">No saved expenses.</p> : (
            <div style={{ overflowX: "auto" }}><table className="table"><thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Total</th><th scope="col">You paid</th><th scope="col">Your share</th><th scope="col">Type</th><th scope="col">Category</th></tr></thead><tbody>
              {expenses.map((expense) => <tr key={expense.id}><td><time dateTime={expense.date}>{expense.date.slice(0, 10)}</time></td><td>{expense.description}</td><td>{expense.currency} {expense.total}</td><td>{expense.paid === null ? "—" : `${expense.currency} ${expense.paid}`}</td><td>{expense.owed === null ? "—" : `${expense.currency} ${expense.owed}`}</td><td>{expense.deleted ? "Deleted" : expense.payment ? "Payment" : "Expense"}</td><td>{expense.payment ? "—" : <ImportCategory source="splitwise" id={expense.id} categoryId={expense.categoryId} categories={categories} />}</td></tr>)}
            </tbody></table></div>
          )}
        </section>
    </>
  );
}
