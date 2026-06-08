import { Fragment } from "react";
import Link from "next/link";
import { ExpenseCategoryGroupOrder } from "@/app/components/ExpenseCategoryGroupOrder";
import {
  deactivateExpenseGroupAction,
  deleteExpenseAction,
  saveExpenseAction,
  saveExpenseGroupAction
} from "@/src/actions/forms";
import { CurrencyFxFields } from "@/app/components/CurrencyFxFields";
import { MoneyStack } from "@/app/components/MoneyStack";
import { RecurrenceFields } from "@/app/components/RecurrenceFields";
import {
  getBaseCurrency,
  listCategories,
  listCurrencies,
  listExpenseGroups,
  listRecurringExpenses,
  type RecurringExpense
} from "@/src/db/repository";
import { formatDisplayMoney, getDisplayMoneyContext } from "@/src/finance/display-money";
import { minorToInputValue } from "@/src/finance/money";

export const dynamic = "force-dynamic";

type ExpenseSortKey = "description" | "category" | "family" | "frequency" | "type" | "amount" | "activeDates";
type GroupSortMode = "manual" | "asc" | "desc";

type Props = {
  searchParams?:
    | { error?: string; edit?: string; sort?: string; dir?: string; groupBy?: string; groupSort?: string }
    | Promise<{ error?: string; edit?: string; sort?: string; dir?: string; groupBy?: string; groupSort?: string }>;
};

export default async function ExpensesPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const currencies = listCurrencies();
  const baseCurrency = getBaseCurrency();
  const displayMoneyContext = await getDisplayMoneyContext(currencies);
  const categories = listCategories("expense");
  const expenseGroups = listExpenseGroups(false);
  const activeExpenseGroups = expenseGroups.filter((group) => group.isActive);
  const sortKey = parseSortKey(params.sort);
  const sortDirection = params.dir === "desc" ? "desc" : "asc";
  const groupByCategory = params.groupBy === "category";
  const groupSort = parseGroupSort(params.groupSort);
  const expenses = sortExpenses(listRecurringExpenses(), sortKey, sortDirection);
  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const groupedExpenses = groupByCategory ? groupExpensesByCategory(expenses, categories, groupSort) : [];

  return (
    <>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Money out</span>
          <h1>Expenses</h1>
          <p className="muted">
            Separate committed recurring expenses from optional scenarios, then compare both on the dashboard.
          </p>
        </div>
      </section>

      {params.error ? <div className="alert">{params.error}</div> : null}

      <details className="create-panel">
        <summary className="button">Add expense</summary>
        <form action={saveExpenseAction} className="panel form-grid">
          <div className="panel-header span-full">
            <div>
              <h2>Add recurring expense</h2>
              <p className="muted">Use committed for fixed obligations and optional for scenario planning.</p>
            </div>
          </div>
          <div className="field span-2">
            <label htmlFor="description">Description</label>
            <input id="description" name="description" placeholder="Rent" required />
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
          <div className="field">
            <label htmlFor="groupId">Family</label>
            <select id="groupId" name="groupId" required>
              {activeExpenseGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <RecurrenceFields idPrefix="new-expense" />
          <div className="field">
            <label htmlFor="isOptional">Type</label>
            <select id="isOptional" name="isOptional" required>
              <option value="false">Committed</option>
              <option value="true">Optional</option>
            </select>
          </div>
          <CurrencyFxFields
            baseCurrencyCode={baseCurrency.code}
            currencies={currencies}
            currencyInputId="currencyCode"
            fxInputId="fxRateToBase"
          />
          <div className="field">
            <label htmlFor="amount">Amount</label>
            <input id="amount" name="amount" inputMode="decimal" placeholder="1500.00" required />
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
            Add expense
          </button>
        </form>
      </details>

      <details className="create-panel">
        <summary className="button button-secondary">Manage families</summary>
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Expense families</h2>
              <p className="muted">Families group recurring expenses across categories and appear in dashboard metrics.</p>
            </div>
            <span className="status-pill status-expense">{activeExpenseGroups.length} active</span>
          </div>

          <form action={saveExpenseGroupAction} className="form-grid compact-form">
            <div className="field span-2">
              <label htmlFor="new-family-name">New family</label>
              <input id="new-family-name" name="name" placeholder="Home, Car, Travel" required />
            </div>
            <button className="button" type="submit">
              Add family
            </button>
          </form>

          {expenseGroups.length === 0 ? (
            <p className="muted">No families yet.</p>
          ) : (
            <div className="grid family-grid">
              {expenseGroups.map((group) => (
                <div className="inline-edit-row" key={group.id}>
                  <form action={saveExpenseGroupAction} className="compact-form">
                    <input type="hidden" name="id" value={group.id} />
                    <div className="field">
                      <label htmlFor={`family-${group.id}`}>Family</label>
                      <input id={`family-${group.id}`} name="name" defaultValue={group.name} required />
                    </div>
                    <button className="button button-secondary" type="submit">
                      Save
                    </button>
                  </form>
                  <span className={`status-pill ${group.isActive ? "status-committed" : "status-optional"}`}>
                    {group.isActive ? "Active" : "Inactive"}
                  </span>
                  {group.isActive && group.name !== "General" ? (
                    <form action={deactivateExpenseGroupAction}>
                      <input type="hidden" name="id" value={group.id} />
                      <button className="button button-danger" type="submit">
                        Deactivate
                      </button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Current recurring expenses</h2>
            <p className="muted">Only active rows are used in monthly projections.</p>
          </div>
          <div className="actions-row">
            <Link
              className="button button-secondary"
              href={buildExpensesQuery({
                params,
                groupBy: groupByCategory ? undefined : "category"
              })}
            >
              {groupByCategory ? "Ungroup" : "Group by category"}
            </Link>
            <span className="status-pill status-expense">{expenses.length} active</span>
          </div>
        </div>
        {groupByCategory ? (
          <div className="group-toolbar">
            <div className="actions-row">
              <Link
                className={`sort-link ${groupSort !== "manual" ? "sort-link-active" : ""}`}
                href={buildExpensesQuery({
                  params,
                  groupSort: nextGroupSort(groupSort)
                })}
              >
                Category groups
                {groupSort === "asc" ? " ↑" : groupSort === "desc" ? " ↓" : ""}
              </Link>
              <span className="muted">Drag to set manual order</span>
            </div>
            <ExpenseCategoryGroupOrder
              categories={groupedExpenses.map((group) => ({
                id: group.categoryId,
                name: group.categoryName
              }))}
            />
          </div>
        ) : null}
        {expenses.length === 0 ? (
          <p className="muted">No recurring expenses yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{renderSortLink("Description", "description", sortKey, sortDirection, params)}</th>
                <th>{renderSortLink("Category", "category", sortKey, sortDirection, params)}</th>
                <th>{renderSortLink("Family", "family", sortKey, sortDirection, params)}</th>
                <th>{renderSortLink("Frequency", "frequency", sortKey, sortDirection, params)}</th>
                <th>{renderSortLink("Type", "type", sortKey, sortDirection, params)}</th>
                <th>{renderSortLink("Amount", "amount", sortKey, sortDirection, params)}</th>
                <th>{renderSortLink("Active Dates", "activeDates", sortKey, sortDirection, params)}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupByCategory
                ? groupedExpenses.map((group) => (
                    <FragmentRows
                      categories={categories}
                      currencyByCode={currencyByCode}
                      currencies={currencies}
                      displayMoneyContext={displayMoneyContext}
                      expenseGroups={expenseGroups}
                      expenses={group.expenses}
                      groupLabel={group.categoryName}
                      groupKey={group.categoryName}
                      key={group.categoryName}
                      params={params}
                      baseCurrencyCode={baseCurrency.code}
                    />
                  ))
                : (
                    <FragmentRows
                      categories={categories}
                      currencyByCode={currencyByCode}
                      currencies={currencies}
                      displayMoneyContext={displayMoneyContext}
                      expenseGroups={expenseGroups}
                      expenses={expenses}
                      params={params}
                      baseCurrencyCode={baseCurrency.code}
                    />
                  )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function FragmentRows({
  expenses,
  categories,
  expenseGroups,
  currencies,
  currencyByCode,
  displayMoneyContext,
  params,
  baseCurrencyCode,
  groupLabel,
  groupKey
}: {
  expenses: RecurringExpense[];
  categories: Awaited<ReturnType<typeof listCategories>>;
  expenseGroups: Awaited<ReturnType<typeof listExpenseGroups>>;
  currencies: Awaited<ReturnType<typeof listCurrencies>>;
  currencyByCode: Map<string, (typeof currencies)[number]>;
  displayMoneyContext: Awaited<ReturnType<typeof getDisplayMoneyContext>>;
  params: Awaited<Props["searchParams"]>;
  baseCurrencyCode: string;
  groupLabel?: string;
  groupKey?: string;
}) {
  return (
    <>
      {groupLabel ? (
        <tr className="group-row" key={`group-${groupKey}`}>
          <td colSpan={8}>{groupLabel}</td>
        </tr>
      ) : null}
      {expenses.map((expense) => {
        const currency = currencyByCode.get(expense.currencyCode);
        const isEditing = params?.edit === `expense-${expense.id}`;
        const groupsForExpense = expenseGroups.filter((group) => group.isActive || group.id === expense.groupId);

        return (
          <Fragment key={expense.id}>
            <tr key={expense.id}>
              <td>{expense.description}</td>
              <td>{expense.categoryName}</td>
              <td>{expense.groupName}</td>
              <td>{formatRecurrence(expense)}</td>
              <td>
                <span className={`status-pill ${expense.isOptional ? "status-optional" : "status-committed"}`}>
                  {expense.isOptional ? "Optional" : "Committed"}
                </span>
              </td>
              <td>
                <MoneyStack
                  values={formatDisplayMoney({
                    amountMinor: expense.amountMinor,
                    currencyCode: expense.currencyCode,
                    fxRateToBase: expense.fxRateToBase,
                    context: displayMoneyContext
                  })}
                />
              </td>
              <td>
                {expense.startDate}
                {expense.endDate ? ` to ${expense.endDate}` : " no end date"}
              </td>
              <td>
                <div className="actions-row">
                  <Link
                    className="button button-secondary"
                    href={buildExpensesQuery({ params, edit: `expense-${expense.id}` })}
                  >
                    Edit
                  </Link>
                  <form action={deleteExpenseAction}>
                    <input type="hidden" name="id" value={expense.id} />
                    <button className="button button-danger" type="submit">
                      Delete
                    </button>
                  </form>
                </div>
              </td>
            </tr>
            {isEditing ? (
              <tr key={`edit-${expense.id}`} className="edit-row">
                <td colSpan={8}>
                  <form action={saveExpenseAction} className="panel form-grid inline-edit-panel">
                    <input type="hidden" name="id" value={expense.id} />
                    <div className="field span-2">
                      <label htmlFor={`description-${expense.id}`}>Description</label>
                      <input id={`description-${expense.id}`} name="description" defaultValue={expense.description} required />
                    </div>
                    <div className="field">
                      <label htmlFor={`category-${expense.id}`}>Category</label>
                      <select id={`category-${expense.id}`} name="categoryId" defaultValue={expense.categoryId} required>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`group-${expense.id}`}>Family</label>
                      <select id={`group-${expense.id}`} name="groupId" defaultValue={expense.groupId} required>
                        {groupsForExpense.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <RecurrenceFields
                      defaultCustomAnchor={expense.customAnchor}
                      defaultCustomDayOfMonth={expense.customDayOfMonth}
                      defaultCustomDayOfWeek={expense.customDayOfWeek}
                      defaultCustomInterval={expense.customInterval}
                      defaultCustomUnit={expense.customUnit}
                      defaultFrequency={expense.frequency}
                      idPrefix={`expense-${expense.id}`}
                    />
                    <div className="field">
                      <label htmlFor={`optional-${expense.id}`}>Type</label>
                      <select
                        id={`optional-${expense.id}`}
                        name="isOptional"
                        defaultValue={expense.isOptional ? "true" : "false"}
                        required
                      >
                        <option value="false">Committed</option>
                        <option value="true">Optional</option>
                      </select>
                    </div>
                    <CurrencyFxFields
                      baseCurrencyCode={baseCurrencyCode}
                      currencies={currencies}
                      currencyInputId={`currency-${expense.id}`}
                      defaultCurrencyCode={expense.currencyCode}
                      defaultFxRate={expense.fxRateToBase}
                      fxInputId={`fx-${expense.id}`}
                    />
                    <div className="field">
                      <label htmlFor={`amount-${expense.id}`}>Amount</label>
                      <input
                        id={`amount-${expense.id}`}
                        name="amount"
                        defaultValue={minorToInputValue(expense.amountMinor, currency?.minorUnit ?? currencies[0].minorUnit)}
                        inputMode="decimal"
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`start-${expense.id}`}>Start date</label>
                      <input
                        id={`start-${expense.id}`}
                        name="startDate"
                        type="date"
                        defaultValue={expense.startDate}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`end-${expense.id}`}>End date</label>
                      <input id={`end-${expense.id}`} name="endDate" type="date" defaultValue={expense.endDate ?? ""} />
                      <span className="field-help">Leave empty for no limit.</span>
                    </div>
                    <div className="actions-row">
                      <button className="button" type="submit">
                        Save
                      </button>
                      <Link className="button button-secondary" href={buildExpensesQuery({ params, edit: undefined })}>
                        Cancel
                      </Link>
                    </div>
                  </form>
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}

function renderSortLink(
  label: string,
  key: ExpenseSortKey,
  activeKey: ExpenseSortKey,
  activeDirection: "asc" | "desc",
  params: Awaited<Props["searchParams"]>
) {
  const nextDirection = activeKey === key && activeDirection === "asc" ? "desc" : "asc";
  const isActive = activeKey === key;

  return (
    <Link className={`sort-link ${isActive ? "sort-link-active" : ""}`} href={buildExpensesQuery({ params, sort: key, dir: nextDirection })}>
      {label}
      {isActive ? (activeDirection === "asc" ? " ↑" : " ↓") : ""}
    </Link>
  );
}

function buildExpensesQuery({
  params,
  edit,
  sort,
  dir,
  groupBy,
  groupSort
}: {
  params: Awaited<Props["searchParams"]>;
  edit?: string;
  sort?: string;
  dir?: string;
  groupBy?: string;
  groupSort?: string;
}) {
  const query = new URLSearchParams();
  const nextEdit = edit === undefined ? undefined : edit;
  const nextSort = sort ?? params?.sort;
  const nextDir = dir ?? params?.dir;
  const nextGroupBy = groupBy === undefined ? params?.groupBy : groupBy;
  const nextGroupSort = groupSort === undefined ? params?.groupSort : groupSort;

  if (params?.error) {
    query.set("error", params.error);
  }
  if (nextEdit) {
    query.set("edit", nextEdit);
  }
  if (nextSort) {
    query.set("sort", nextSort);
  }
  if (nextDir) {
    query.set("dir", nextDir);
  }
  if (nextGroupBy) {
    query.set("groupBy", nextGroupBy);
  }
  if (nextGroupSort) {
    query.set("groupSort", nextGroupSort);
  }

  const suffix = query.toString();
  return suffix ? `/expenses?${suffix}` : "/expenses";
}

function parseSortKey(value?: string): ExpenseSortKey {
  const allowed: ExpenseSortKey[] = ["description", "category", "family", "frequency", "type", "amount", "activeDates"];
  return allowed.includes(value as ExpenseSortKey) ? (value as ExpenseSortKey) : "description";
}

function parseGroupSort(value?: string): GroupSortMode {
  return value === "asc" || value === "desc" ? value : "manual";
}

function nextGroupSort(current: GroupSortMode): GroupSortMode {
  return current === "manual" ? "asc" : current === "asc" ? "desc" : "manual";
}

function sortExpenses(expenses: RecurringExpense[], sortKey: ExpenseSortKey, direction: "asc" | "desc") {
  const factor = direction === "asc" ? 1 : -1;
  return [...expenses].sort((left, right) => {
    const compare =
      sortKey === "description"
        ? left.description.localeCompare(right.description)
        : sortKey === "category"
          ? left.categoryName.localeCompare(right.categoryName)
          : sortKey === "family"
            ? left.groupName.localeCompare(right.groupName)
            : sortKey === "frequency"
              ? formatRecurrence(left).localeCompare(formatRecurrence(right))
              : sortKey === "type"
                ? Number(left.isOptional) - Number(right.isOptional)
                : sortKey === "amount"
                  ? left.amountMinor - right.amountMinor
                  : `${left.startDate}:${left.endDate ?? ""}`.localeCompare(`${right.startDate}:${right.endDate ?? ""}`);

    return compare === 0 ? left.description.localeCompare(right.description) : compare * factor;
  });
}

function groupExpensesByCategory(expenses: RecurringExpense[], categories: Awaited<ReturnType<typeof listCategories>>, groupSort: GroupSortMode) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const groups = new Map<string, { categoryId: number; categoryName: string; sortOrder: number; expenses: RecurringExpense[] }>();

  for (const expense of expenses) {
    const category = categoryById.get(expense.categoryId);
    const current = groups.get(expense.categoryName) ?? {
      categoryId: expense.categoryId,
      categoryName: expense.categoryName,
      sortOrder: category?.sortOrder ?? 0,
      expenses: []
    };
    current.expenses.push(expense);
    groups.set(expense.categoryName, current);
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (groupSort === "asc") {
      return left.categoryName.localeCompare(right.categoryName);
    }
    if (groupSort === "desc") {
      return right.categoryName.localeCompare(left.categoryName);
    }

    return left.sortOrder - right.sortOrder || left.categoryName.localeCompare(right.categoryName);
  });
}

function formatRecurrence(expense: RecurringExpense) {
  if (expense.frequency !== "custom") {
    return expense.frequency;
  }

  const interval = expense.customInterval ?? 1;
  const unit = expense.customUnit ?? "months";
  const anchor =
    expense.customAnchor === "day_of_week"
      ? weekdayName(expense.customDayOfWeek ?? 1)
      : `day ${expense.customDayOfMonth ?? 1}`;

  return `every ${interval} ${interval === 1 ? unit.slice(0, -1) : unit} on ${anchor}`;
}

function weekdayName(value: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value] ?? "Monday";
}
