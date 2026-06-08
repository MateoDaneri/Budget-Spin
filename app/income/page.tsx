import Link from "next/link";
import { deleteIncomeAction, saveIncomeAction } from "@/src/actions/forms";
import { CurrencyFxFields } from "@/app/components/CurrencyFxFields";
import { MoneyStack } from "@/app/components/MoneyStack";
import { RecurrenceFields } from "@/app/components/RecurrenceFields";
import { getBaseCurrency, listCategories, listCurrencies, listIncomeItems, type IncomeItem } from "@/src/db/repository";
import { formatDisplayMoney, getDisplayMoneyContext } from "@/src/finance/display-money";
import { minorToInputValue } from "@/src/finance/money";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { error?: string; edit?: string } | Promise<{ error?: string; edit?: string }>;
};

export default async function IncomePage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const currencies = listCurrencies();
  const baseCurrency = getBaseCurrency();
  const displayMoneyContext = await getDisplayMoneyContext(currencies);
  const categories = listCategories("income");
  const incomeItems = listIncomeItems();
  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]));

  return (
    <>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Money in</span>
          <h1>Income</h1>
          <p className="muted">
            Recurring income concepts used by the dashboard projection. FX is required when currency is not {baseCurrency.code}.
          </p>
        </div>
      </section>

      {params.error ? <div className="alert">{params.error}</div> : null}

      <details className="create-panel">
        <summary className="button">Add income</summary>
        <form action={saveIncomeAction} className="panel form-grid">
          <div className="panel-header span-full">
            <div>
              <h2>Add recurring income</h2>
              <p className="muted">Salary, freelance retainers, bonuses, aguinaldos, or other predictable income.</p>
            </div>
          </div>
          <div className="field span-2">
            <label htmlFor="description">Description</label>
            <input id="description" name="description" placeholder="Salary" required />
          </div>
          <div className="field">
            <label htmlFor="categoryId">Category</label>
            <select id="categoryId" name="categoryId" required>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <RecurrenceFields idPrefix="new-income" />
          <CurrencyFxFields
            baseCurrencyCode={baseCurrency.code}
            currencies={currencies}
            currencyInputId="currencyCode"
            fxInputId="fxRateToBase"
          />
          <div className="field">
            <label htmlFor="amount">Amount</label>
            <input id="amount" name="amount" inputMode="decimal" placeholder="100000.00" required />
          </div>
          <div className="field">
            <label htmlFor="startDate">Start date</label>
            <input id="startDate" name="startDate" type="date" required />
          </div>
          <div className="field">
            <label htmlFor="endDate">End date</label>
            <input id="endDate" name="endDate" type="date" />
            <span className="field-help">Leave empty for no limit.</span>
          </div>
          <button className="button" type="submit">
            Add income
          </button>
        </form>
      </details>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Current income</h2>
            <p className="muted">Only occurrences inside each selected month are used in projections.</p>
          </div>
          <span className="status-pill status-income">{incomeItems.length} active</span>
        </div>
        {incomeItems.length === 0 ? (
          <p className="muted">No income items yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Category</th>
                <th>Frequency</th>
                <th>Amount</th>
                <th>Active Dates</th>
                <th>FX</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incomeItems.map((item) => {
                const currency = currencyByCode.get(item.currencyCode);
                const isEditing = params.edit === `income-${item.id}`;
                return (
                  <>
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>
                        <span className="status-pill status-income">{item.categoryName}</span>
                      </td>
                      <td>{formatRecurrence(item)}</td>
                      <td>
                        <MoneyStack
                          values={formatDisplayMoney({
                            amountMinor: item.amountMinor,
                            currencyCode: item.currencyCode,
                            fxRateToBase: item.fxRateToBase,
                            context: displayMoneyContext
                          })}
                        />
                      </td>
                      <td>
                        {item.startDate}
                        {item.endDate ? ` to ${item.endDate}` : " no end date"}
                      </td>
                      <td>{item.fxRateToBase ?? "base"}</td>
                      <td>
                        <div className="actions-row">
                          <Link className="button button-secondary" href={`/income?edit=income-${item.id}`}>
                            Edit
                          </Link>
                          <form action={deleteIncomeAction}>
                            <input type="hidden" name="id" value={item.id} />
                            <button className="button button-danger" type="submit">
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                    {isEditing ? (
                      <tr key={`edit-${item.id}`} className="edit-row">
                        <td colSpan={7}>
                          <form action={saveIncomeAction} className="panel form-grid inline-edit-panel">
                            <input type="hidden" name="id" value={item.id} />
                            <div className="field span-2">
                              <label htmlFor={`description-${item.id}`}>Description</label>
                              <input id={`description-${item.id}`} name="description" defaultValue={item.description} required />
                            </div>
                            <div className="field">
                              <label htmlFor={`category-${item.id}`}>Category</label>
                              <select id={`category-${item.id}`} name="categoryId" defaultValue={item.categoryId} required>
                                {categories.map((category) => (
                                  <option key={category.id} value={category.id}>
                                    {category.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <RecurrenceFields
                              defaultCustomAnchor={item.customAnchor}
                              defaultCustomDayOfMonth={item.customDayOfMonth}
                              defaultCustomDayOfWeek={item.customDayOfWeek}
                              defaultCustomInterval={item.customInterval}
                              defaultCustomUnit={item.customUnit}
                              defaultFrequency={item.frequency}
                              idPrefix={`income-${item.id}`}
                            />
                            <CurrencyFxFields
                              baseCurrencyCode={baseCurrency.code}
                              currencies={currencies}
                              currencyInputId={`currency-${item.id}`}
                              defaultCurrencyCode={item.currencyCode}
                              defaultFxRate={item.fxRateToBase}
                              fxInputId={`fx-${item.id}`}
                            />
                            <div className="field">
                              <label htmlFor={`amount-${item.id}`}>Amount</label>
                              <input
                                id={`amount-${item.id}`}
                                name="amount"
                                defaultValue={minorToInputValue(item.amountMinor, currency?.minorUnit ?? currencies[0].minorUnit)}
                                inputMode="decimal"
                                required
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`start-${item.id}`}>Start date</label>
                              <input
                                id={`start-${item.id}`}
                                name="startDate"
                                type="date"
                                defaultValue={item.startDate}
                                required
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`end-${item.id}`}>End date</label>
                              <input id={`end-${item.id}`} name="endDate" type="date" defaultValue={item.endDate ?? ""} />
                              <span className="field-help">Leave empty for no limit.</span>
                            </div>
                            <div className="actions-row">
                              <button className="button" type="submit">
                                Save
                              </button>
                              <Link className="button button-secondary" href="/income">
                                Cancel
                              </Link>
                            </div>
                          </form>
                        </td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function formatRecurrence(item: IncomeItem) {
  if (item.frequency !== "custom") {
    return item.frequency;
  }

  const interval = item.customInterval ?? 1;
  const unit = item.customUnit ?? "months";
  const anchor =
    item.customAnchor === "day_of_week"
      ? weekdayName(item.customDayOfWeek ?? 1)
      : `day ${item.customDayOfMonth ?? 1}`;

  return `every ${interval} ${interval === 1 ? unit.slice(0, -1) : unit} on ${anchor}`;
}

function weekdayName(value: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value] ?? "Monday";
}
