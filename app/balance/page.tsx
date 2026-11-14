import Link from "next/link";
import {
  addBalanceAdjustmentAction,
  clearOpeningBalanceAction,
  deleteBalanceAdjustmentAction,
  saveOpeningBalanceAction
} from "@/src/actions/balance";
import { formErrorMessage } from "@/src/actions/error-codes";
import { listBalanceAdjustments, listCurrencies, listOpeningBalances } from "@/src/db/repository";
import { dateOnly } from "@/src/finance/dates";
import { formatMoney, minorToInputValue } from "@/src/finance/money";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { error?: string } | Promise<{ error?: string }>;
};

export default async function BalancePage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  // Fixed message per known code; the query value itself is never rendered.
  const errorMessage = formErrorMessage(params.error);
  const currencies = listCurrencies();
  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const openings = new Map(listOpeningBalances().map((opening) => [opening.currencyCode, opening]));
  const adjustments = listBalanceAdjustments();
  const today = dateOnly(new Date());
  const show = (currencyCode: string, amountMinor: number) => {
    const currency = currencyByCode.get(currencyCode);
    return currency ? formatMoney(amountMinor, currency) : `${currencyCode} ${amountMinor}`;
  };

  return (
    <>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Money you have</span>
          <h1>Balance</h1>
          <p className="muted">
            Starting point and manual corrections for the running balance shown on the <Link href="/#real-net">overview</Link>.
          </p>
        </div>
      </section>

      {errorMessage ? <div className="alert" role="alert">{errorMessage}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Opening balance</h2>
            <p className="muted">
              The amount you had at the end of the chosen day. Income, spending and adjustments after that day move it.
              To stop an income, set its end date instead of deleting it: deleting removes it from past balances.
            </p>
          </div>
        </div>
        {currencies.map((currency) => {
          const opening = openings.get(currency.code);
          const prefix = `opening-${currency.code}`;
          return (
            <form key={currency.code} action={saveOpeningBalanceAction} className="form-grid">
              <input type="hidden" name="currencyCode" value={currency.code} />
              <div className="field">
                <label htmlFor={`${prefix}-amount`}>{currency.code} amount</label>
                <input
                  id={`${prefix}-amount`}
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={opening ? minorToInputValue(opening.amountMinor, currency.minorUnit) : ""}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor={`${prefix}-date`}>As of</label>
                <input id={`${prefix}-date`} name="asOfDate" type="date" max={today} defaultValue={opening?.asOfDate ?? today} required />
              </div>
              <button className="button" type="submit">
                Save {currency.code}
              </button>
              {opening ? (
                <button className="button button-secondary" type="submit" formAction={clearOpeningBalanceAction} formNoValidate>
                  Remove {currency.code}
                </button>
              ) : (
                <span className="field-help">No opening balance: the overview shows no {currency.code} balance.</span>
              )}
            </form>
          );
        })}
      </div>

      <details className="create-panel">
        <summary className="button">Add adjustment</summary>
        <form action={addBalanceAdjustmentAction} className="panel form-grid">
          <div className="field">
            <label htmlFor="adjustment-currency">Currency</label>
            <select id="adjustment-currency" name="currencyCode" required>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adjustment-amount">Amount</label>
            <input id="adjustment-amount" name="amount" inputMode="decimal" placeholder="-250.00" required />
            <span className="field-help">Negative for money out, positive for money in.</span>
          </div>
          <div className="field">
            <label htmlFor="adjustment-date">Date</label>
            <input id="adjustment-date" name="adjustmentDate" type="date" max={today} defaultValue={today} required />
          </div>
          <div className="field span-2">
            <label htmlFor="adjustment-note">Note</label>
            <input id="adjustment-note" name="note" maxLength={500} placeholder="Cash withdrawal not in any notice" required />
          </div>
          <button className="button" type="submit">
            Add adjustment
          </button>
        </form>
      </details>

      <div className="panel collection-list">
        <div className="panel-header">
          <div>
            <h2>Adjustments</h2>
          </div>
          <span className="status-pill">{adjustments.length}</span>
        </div>
        {adjustments.length === 0 ? (
          <p className="muted">No adjustments yet.</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Adjustments table">
            <table className="table record-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Date">{item.adjustmentDate}</td>
                    <td data-label="Amount">{show(item.currencyCode, item.amountMinor)}</td>
                    <td data-label="Note">{item.note}</td>
                    <td data-label="Actions">
                      <form action={deleteBalanceAdjustmentAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <button className="button button-secondary" type="submit">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
