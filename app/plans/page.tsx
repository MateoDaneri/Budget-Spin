import {
  deletePlanAction,
  deletePlanItemAction,
  savePlanAction,
  savePlanItemAction,
  togglePlanItemAction
} from "@/src/actions/forms";
import { CurrencyFxFields } from "@/app/components/CurrencyFxFields";
import { MoneyStack } from "@/app/components/MoneyStack";
import {
  getBaseCurrency,
  listCurrencies,
  listFinancialPlans,
  listIncomeItems,
  listPlanItems,
  listRecurringExpenses
} from "@/src/db/repository";
import { currentMonthKey, formatMonthLabel } from "@/src/finance/dates";
import {
  type DisplayMoneyValue,
  formatDisplayMoney,
  formatDisplayMoneyFromBase,
  getDisplayMoneyContext
} from "@/src/finance/display-money";
import { minorToInputValue } from "@/src/finance/money";
import { calculatePlanProjection } from "@/src/finance/plans";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { error?: string } | Promise<{ error?: string }>;
};

export default async function PlansPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const currencies = listCurrencies();
  const baseCurrency = getBaseCurrency();
  const displayMoneyContext = await getDisplayMoneyContext(currencies);
  const plans = listFinancialPlans();
  const items = listPlanItems();
  const incomes = listIncomeItems();
  const expenses = listRecurringExpenses();
  const currentMonth = currentMonthKey();
  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const itemsByPlan = new Map<number, typeof items>();

  for (const item of items) {
    itemsByPlan.set(item.planId, [...(itemsByPlan.get(item.planId) ?? []), item]);
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Goals</span>
          <h1>Plans</h1>
          <p className="muted">
            One-off goals like trips or big purchases. Track the target, the purchases, and the monthly pressure.
          </p>
        </div>
      </section>

      {params.error ? <div className="alert">{params.error}</div> : null}

      <details className="create-panel">
        <summary className="button">Create plan</summary>
        <form action={savePlanAction} className="panel form-grid">
          <div className="panel-header span-full">
            <div>
              <h2>Create a plan</h2>
              <p className="muted">Example: August trip, USD 2500, target date, and notes.</p>
            </div>
          </div>
          <div className="field span-2">
            <label htmlFor="name">Plan</label>
            <input id="name" name="name" placeholder="August trip" required />
          </div>
          <div className="field">
            <label htmlFor="targetDate">Target date</label>
            <input id="targetDate" name="targetDate" type="date" required />
          </div>
          <CurrencyFxFields
            baseCurrencyCode={baseCurrency.code}
            currencies={currencies}
            currencyInputId="planCurrencyCode"
            fxInputId="planFxRateToBase"
          />
          <div className="field">
            <label htmlFor="targetAmount">Estimated total</label>
            <input id="targetAmount" name="targetAmount" inputMode="decimal" placeholder="2500.00" required />
          </div>
          <div className="field span-2">
            <label htmlFor="notes">Notes</label>
            <input id="notes" name="notes" placeholder="Flights, hotel, food" />
          </div>
          <button className="button" type="submit">
            Add plan
          </button>
        </form>
      </details>

      <section className="section-title">
        <div>
          <h2>Active plans</h2>
          <p className="muted">Each card shows progress and whether projected net can cover what remains.</p>
        </div>
      </section>

      {plans.length === 0 ? (
        <div className="panel">
          <p className="muted">No plans yet.</p>
        </div>
      ) : (
        <div className="grid">
          {plans.map((plan) => {
            const planItems = itemsByPlan.get(plan.id) ?? [];
            const planCurrency = currencyByCode.get(plan.currencyCode) ?? currencies[0];
            const projection = calculatePlanProjection({
              plan,
              items: planItems,
              incomes,
              expenses,
              currencies,
              baseCurrency,
              currentMonth
            });
            const progress =
              projection.targetBaseMinor > 0
                ? Math.min(100, Math.round((projection.itemDoneBaseMinor / projection.targetBaseMinor) * 100))
                : 100;
            const planDisplayMoney = (amountMinor: number) =>
              formatDisplayMoneyFromBase({
                amountMinor,
                baseCurrency,
                preferredCurrencyCode: plan.currencyCode,
                preferredFxRateToBase: plan.fxRateToBase,
                context: displayMoneyContext
              });

            return (
              <article className="panel plan-card" id={`plan-${plan.id}`} key={plan.id}>
                <div className="plan-header">
                  <div>
                    <h3>{plan.name}</h3>
                    <p className="muted">
                      Target: {plan.targetDate} - {projection.monthsToTarget.length} month
                      {projection.monthsToTarget.length === 1 ? "" : "s"} from {formatMonthLabel(currentMonth)}
                    </p>
                    {plan.notes ? <p className="muted">{plan.notes}</p> : null}
                  </div>
                  <form action={deletePlanAction}>
                    <input type="hidden" name="id" value={plan.id} />
                    <button className="button button-danger" type="submit">
                      Delete plan
                    </button>
                  </form>
                </div>

                <div className="grid grid-4">
                  <MetricCard
                    label="Estimated total"
                    values={formatDisplayMoney({
                      amountMinor: plan.targetAmountMinor,
                      currencyCode: plan.currencyCode,
                      fxRateToBase: plan.fxRateToBase,
                      context: displayMoneyContext
                    })}
                  />
                  <MetricCard
                    label="Already bought"
                    values={planDisplayMoney(projection.itemDoneBaseMinor)}
                  />
                  <MetricCard
                    label="Still to cover"
                    values={planDisplayMoney(projection.remainingBaseMinor)}
                  />
                  <MetricCard
                    label="Needed per month"
                    values={planDisplayMoney(projection.monthlyRequiredBaseMinor)}
                  />
                </div>

                <div className="progress-block">
                  <div className="panel-header">
                    <div>
                      <h3>Purchase progress</h3>
                      <p className="muted">Done purchases reduce what is still needed.</p>
                    </div>
                    <span className={`status-pill ${progress >= 100 ? "status-done" : "status-pending"}`}>{progress}% done</span>
                  </div>
                  <div className="progress-track" aria-hidden="true">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="muted">
                    {progress}% bought - Purchases planned:{" "}
                    <MoneyStack values={planDisplayMoney(projection.itemPlannedBaseMinor)} />
                  </span>
                </div>

                <div className="grid grid-2">
                  <PlanFitCard
                    label="Base scenario"
                    description="Only committed expenses."
                    gap={projection.committedGapBaseMinor}
                    available={projection.committedAvailableBaseMinor}
                    baseCurrency={baseCurrency}
                    context={displayMoneyContext}
                    preferredCurrencyCode={plan.currencyCode}
                    preferredFxRateToBase={plan.fxRateToBase}
                  />
                  <PlanFitCard
                    label="Optional scenario"
                    description="Committed plus optional expenses."
                    gap={projection.withOptionalGapBaseMinor}
                    available={projection.withOptionalAvailableBaseMinor}
                    baseCurrency={baseCurrency}
                    context={displayMoneyContext}
                    preferredCurrencyCode={plan.currencyCode}
                    preferredFxRateToBase={plan.fxRateToBase}
                  />
                </div>

                <details className="details-panel">
                  <summary className="button button-secondary">How this is calculated</summary>
                  <div className="subsection-block plan-calculation">
                    <div className="panel-header">
                      <div>
                        <h3>Plan inputs</h3>
                        <p className="muted">
                          This plan uses {projection.monthsToTarget.length} month
                          {projection.monthsToTarget.length === 1 ? "" : "s"}:{" "}
                          {projection.monthsToTarget.map(formatMonthLabel).join(", ") || "none"}.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-3">
                      <FormulaCard
                        label="Remaining"
                        formula="Estimated total minus done purchases"
                        values={planDisplayMoney(projection.remainingBaseMinor)}
                      />
                      <FormulaCard
                        label="Needed per month"
                        formula="Remaining divided by months to target"
                        values={planDisplayMoney(projection.monthlyRequiredBaseMinor)}
                      />
                      <FormulaCard
                        label="Scenario fit"
                        formula="Projected available minus remaining"
                        values={planDisplayMoney(projection.committedGapBaseMinor)}
                      />
                    </div>

                    {projection.monthlyInputs.length === 0 ? (
                      <p className="muted">The target month is before the current month, so no future months are included.</p>
                    ) : (
                      <table className="table trend-table">
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th>Income</th>
                            <th>Committed expenses</th>
                            <th>Optional expenses</th>
                            <th>Net committed</th>
                            <th>Net with optional</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projection.monthlyInputs.map((monthInput) => (
                            <tr key={monthInput.month}>
                              <td>{formatMonthLabel(monthInput.month)}</td>
                              <td>
                                <MoneyStack values={planDisplayMoney(monthInput.incomeBaseMinor)} />
                              </td>
                              <td>
                                <MoneyStack values={planDisplayMoney(monthInput.committedExpenseBaseMinor)} />
                              </td>
                              <td>
                                <MoneyStack values={planDisplayMoney(monthInput.optionalExpenseBaseMinor)} />
                              </td>
                              <td>
                                <MoneyStack values={planDisplayMoney(monthInput.committedNetBaseMinor)} />
                              </td>
                              <td>
                                <MoneyStack values={planDisplayMoney(monthInput.netWithOptionalBaseMinor)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </details>

                <form action={savePlanItemAction} className="form-grid compact-form">
                  <div className="panel-header span-full">
                    <div>
                      <h3>Add purchase</h3>
                      <p className="muted">Break the plan into concrete items like flight, hotel, insurance, or food.</p>
                    </div>
                  </div>
                  <input type="hidden" name="planId" value={plan.id} />
                  <div className="field span-2">
                    <label htmlFor={`item-description-${plan.id}`}>Description</label>
                    <input id={`item-description-${plan.id}`} name="description" placeholder="Flight" required />
                  </div>
                  <CurrencyFxFields
                    baseCurrencyCode={baseCurrency.code}
                    currencies={currencies}
                    currencyInputId={`itemCurrencyCode-${plan.id}`}
                    fxInputId={`itemFxRateToBase-${plan.id}`}
                  />
                  <div className="field">
                    <label htmlFor={`item-amount-${plan.id}`}>Amount</label>
                    <input id={`item-amount-${plan.id}`} name="amount" inputMode="decimal" placeholder="650.00" required />
                  </div>
                  <div className="field">
                    <label htmlFor={`item-status-${plan.id}`}>Status</label>
                    <select id={`item-status-${plan.id}`} name="isDone" defaultValue="false" required>
                      <option value="false">Pending</option>
                      <option value="true">Done</option>
                    </select>
                  </div>
                  <button className="button" type="submit">
                    Add purchase
                  </button>
                </form>

                {planItems.length === 0 ? (
                  <p className="muted">No purchases added yet.</p>
                ) : (
                  <div className="subsection-block">
                    <div className="panel-header">
                      <div>
                        <h3>Purchase checklist</h3>
                        <p className="muted">Pending items still count as planned. Done items count as already bought.</p>
                      </div>
                    </div>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Description</th>
                          <th>Amount</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {planItems.map((item) => {
                          return (
                            <tr className={item.isDone ? "done-row" : undefined} key={item.id}>
                              <td>
                                <span className={`status-pill ${item.isDone ? "status-done" : "status-pending"}`}>
                                  {item.isDone ? "Done" : "Pending"}
                                </span>
                              </td>
                              <td>{item.description}</td>
                              <td>
                                <MoneyStack
                                  values={formatDisplayMoney({
                                    amountMinor: item.amountMinor,
                                    currencyCode: item.currencyCode,
                                    fxRateToBase: item.fxRateToBase,
                                    preferredCurrencyCode: plan.currencyCode,
                                    preferredFxRateToBase: plan.fxRateToBase,
                                    context: displayMoneyContext
                                  })}
                                />
                              </td>
                              <td>
                                <div className="actions-row">
                                  <form action={togglePlanItemAction}>
                                    <input type="hidden" name="planId" value={plan.id} />
                                    <input type="hidden" name="id" value={item.id} />
                                    <input type="hidden" name="isDone" value={item.isDone ? "false" : "true"} />
                                    <button className="button button-secondary" type="submit">
                                      {item.isDone ? "Undo" : "Mark done"}
                                    </button>
                                  </form>
                                  <form action={deletePlanItemAction}>
                                    <input type="hidden" name="planId" value={plan.id} />
                                    <input type="hidden" name="id" value={item.id} />
                                    <button className="button button-danger" type="submit">
                                      Delete
                                    </button>
                                  </form>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <section className="section-title">
                  <h3>Edit Plan Assumptions</h3>
                </section>
                <form action={savePlanAction} className="form-grid compact-form">
                  <input type="hidden" name="id" value={plan.id} />
                  <div className="field span-2">
                    <label htmlFor={`plan-name-${plan.id}`}>Plan</label>
                    <input id={`plan-name-${plan.id}`} name="name" defaultValue={plan.name} required />
                  </div>
                  <div className="field">
                    <label htmlFor={`plan-target-${plan.id}`}>Target date</label>
                    <input id={`plan-target-${plan.id}`} name="targetDate" type="date" defaultValue={plan.targetDate} required />
                  </div>
                  <CurrencyFxFields
                    baseCurrencyCode={baseCurrency.code}
                    currencies={currencies}
                    currencyInputId={`planCurrency-${plan.id}`}
                    defaultCurrencyCode={plan.currencyCode}
                    defaultFxRate={plan.fxRateToBase}
                    fxInputId={`planFx-${plan.id}`}
                  />
                  <div className="field">
                    <label htmlFor={`plan-amount-${plan.id}`}>Estimated total</label>
                    <input
                      id={`plan-amount-${plan.id}`}
                      name="targetAmount"
                      defaultValue={minorToInputValue(plan.targetAmountMinor, planCurrency.minorUnit)}
                      inputMode="decimal"
                      required
                    />
                  </div>
                  <div className="field span-2">
                    <label htmlFor={`plan-notes-${plan.id}`}>Notes</label>
                    <input id={`plan-notes-${plan.id}`} name="notes" defaultValue={plan.notes ?? ""} />
                  </div>
                  <button className="button" type="submit">
                    Save plan
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function MetricCard({ label, values }: { label: string; values: DisplayMoneyValue[] }) {
  return (
    <div className="mini-panel">
      <span className="metric-label">{label}</span>
      <strong>
        <MoneyStack values={values} />
      </strong>
    </div>
  );
}

function FormulaCard({ label, formula, values }: { label: string; formula: string; values: DisplayMoneyValue[] }) {
  return (
    <div className="mini-panel formula-card">
      <span className="metric-label">{label}</span>
      <strong>
        <MoneyStack values={values} />
      </strong>
      <p className="scenario-note">{formula}</p>
    </div>
  );
}

function PlanFitCard({
  label,
  description,
  gap,
  available,
  baseCurrency,
  preferredCurrencyCode,
  preferredFxRateToBase,
  context
}: {
  label: string;
  description: string;
  gap: number;
  available: number;
  baseCurrency: ReturnType<typeof getBaseCurrency>;
  preferredCurrencyCode: string;
  preferredFxRateToBase: number | null;
  context: Awaited<ReturnType<typeof getDisplayMoneyContext>>;
}) {
  const isShort = gap < 0;
  const formatPlanMoney = (amountMinor: number) =>
    formatDisplayMoneyFromBase({
      amountMinor,
      baseCurrency,
      preferredCurrencyCode,
      preferredFxRateToBase,
      context
    });

  return (
    <div className={`mini-panel ${isShort ? "fit-short" : "fit-ok"}`}>
      <span className="metric-label">{label}</span>
      <p className="scenario-note">{description}</p>
      <div className="amount-block">
        <strong>{isShort ? "Short by" : "Buffer"}</strong>
        <MoneyStack values={formatPlanMoney(Math.abs(gap))} />
      </div>
      <p className="muted">
        Projected available: <MoneyStack values={formatPlanMoney(available)} />
      </p>
    </div>
  );
}
