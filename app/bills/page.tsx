import Link from "next/link";
import { archiveBillAction, saveBillAction, setBillPaidAction } from "@/src/actions/bills";
import { formErrorMessage } from "@/src/actions/error-codes";
import { listBillPayments, listBills, listCurrencies, type Currency } from "@/src/db/repository";
import { billsForMonth, type BillRow } from "@/src/finance/bills";
import { addMonths, currentMonthKey, formatMonthLabel } from "@/src/finance/dates";
import { formatMoney, minorToInputValue } from "@/src/finance/money";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { month?: string; error?: string } | Promise<{ month?: string; error?: string }>;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function BillsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const month = params.month && MONTH.test(params.month) ? params.month : currentMonthKey();
  // Fixed message per known code; the query value itself is never rendered.
  const errorMessage = formErrorMessage(params.error);
  const currencies = listCurrencies();
  const rows = billsForMonth(month, listBills(), listBillPayments(month));
  const paidCount = rows.filter((row) => row.paidAt).length;

  return (
    <>
      <section className="overview-heading">
        <div>
          <h1>Bills</h1>
          <p className="muted">
            {formatMonthLabel(month)} · {rows.length === 0 ? "nothing to pay yet" : `${paidCount} of ${rows.length} paid`}
          </p>
        </div>
        <nav className="month-picker" aria-label="Choose month">
          <Link href={`/bills?month=${addMonths(month, -1)}`} aria-label="Previous month">←</Link>
          <Link href={`/bills?month=${currentMonthKey()}`}>Today</Link>
          <Link href={`/bills?month=${addMonths(month, 1)}`} aria-label="Next month">→</Link>
        </nav>
      </section>

      {errorMessage ? <div className="alert" role="alert">{errorMessage}</div> : null}

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">Add the bills you pay each month.</p>
        ) : (
          <ul className="bill-list">
            {rows.map((row) => (
              <BillItem key={row.id} row={row} month={month} currencies={currencies} />
            ))}
          </ul>
        )}
      </div>

      <details className="create-panel">
        <summary className="button">Add bill</summary>
        <form action={saveBillAction} className="panel form-grid">
          <input type="hidden" name="month" value={month} />
          <BillFields prefix="new-bill" currencies={currencies} />
          <button className="button" type="submit">Add bill</button>
        </form>
      </details>
    </>
  );
}

function BillItem({ row, month, currencies }: { row: BillRow; month: string; currencies: Currency[] }) {
  const currency = currencies.find((item) => item.code === row.currencyCode);
  const amount = row.amountMinor !== null && currency ? formatMoney(row.amountMinor, currency) : null;
  const paidOn = row.paidAt ? new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(row.paidAt)) : null;
  const labelId = `bill-${row.id}-name`;

  return (
    <li className="bill-row" data-paid={row.paidAt ? "yes" : "no"}>
      <form action={setBillPaidAction} className="bill-toggle">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="paid" value={row.paidAt ? "no" : "yes"} />
        <button type="submit" className="bill-check" aria-pressed={row.paidAt ? "true" : "false"} aria-describedby={labelId}>
          <span aria-hidden="true">{row.paidAt ? "✓" : ""}</span>
          <span className="sr-only">{row.paidAt ? "Mark as not paid" : "Mark as paid"}</span>
        </button>
      </form>
      <span className="bill-name" id={labelId}>{row.name}</span>
      <span className="bill-meta">{row.dueDay ? `day ${row.dueDay}` : ""}</span>
      <span className="bill-amount">{amount ?? "—"}</span>
      <span className="bill-meta">{paidOn ? `paid ${paidOn}` : ""}</span>
      {row.isActive ? (
        <details className="bill-edit">
          <summary aria-label={`Edit ${row.name}`}>Edit</summary>
          <form action={saveBillAction} className="form-grid">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="month" value={month} />
            <BillFields prefix={`bill-${row.id}`} currencies={currencies} row={row} />
            <button className="button" type="submit">Save</button>
            <button className="button button-secondary" type="submit" formAction={archiveBillAction} formNoValidate>
              Remove from future months
            </button>
          </form>
        </details>
      ) : (
        <span className="bill-meta">removed</span>
      )}
    </li>
  );
}

function BillFields({ prefix, currencies, row }: { prefix: string; currencies: Currency[]; row?: BillRow }) {
  const currency = currencies.find((item) => item.code === row?.currencyCode);
  return (
    <>
      <div className="field span-2">
        <label htmlFor={`${prefix}-name`}>Name</label>
        <input id={`${prefix}-name`} name="name" maxLength={120} defaultValue={row?.name ?? ""} placeholder="Accountant" required />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-amount`}>Amount</label>
        <input
          id={`${prefix}-amount`}
          name="amount"
          inputMode="decimal"
          placeholder="Leave empty if it varies"
          defaultValue={row?.amountMinor != null && currency ? minorToInputValue(row.amountMinor, currency.minorUnit) : ""}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-currency`}>Currency</label>
        <select id={`${prefix}-currency`} name="currencyCode" defaultValue={row?.currencyCode ?? currencies.find((item) => item.isBase)?.code}>
          {currencies.map((item) => (
            <option key={item.code} value={item.code}>{item.code}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-day`}>Due day</label>
        <input id={`${prefix}-day`} name="dueDay" type="number" min={1} max={31} defaultValue={row?.dueDay ?? ""} placeholder="Optional" />
      </div>
    </>
  );
}
