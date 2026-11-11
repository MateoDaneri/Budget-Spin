import Link from "next/link";
import { MoneyStack } from "@/app/components/MoneyStack";
import { getBaseCurrency, listCurrencies, listIncomeItems, listRecurringExpenses, listTransactions } from "@/src/db/repository";
import { addMonths, currentMonthKey, formatMonthLabel, trailingMonths } from "@/src/finance/dates";
import { formatDisplayMoneyFromUyu, getDisplayMoneyContext } from "@/src/finance/display-money";
import { calculateMonthMetrics } from "@/src/finance/metrics";
import { calculateActualMonth } from "@/src/finance/actual-spending";
import { listPairExclusions, listSplitwiseImports } from "@/src/splitwise/store";
import { setPairExclusionAction } from "@/src/actions/reconciliation";
import { formatMoney } from "@/src/finance/money";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { month?: string; reconciliation?: string } | Promise<{ month?: string; reconciliation?: string }>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const month = params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : currentMonthKey();
  const currencies = listCurrencies();
  const baseCurrency = getBaseCurrency();
  const displayMoneyContext = await getDisplayMoneyContext(currencies);
  const incomes = listIncomeItems();
  const expenses = listRecurringExpenses();
  const metrics = calculateMonthMetrics({ month, incomes, expenses, currencies, baseCurrency });
  const transactions = listTransactions(Number.MAX_SAFE_INTEGER);
  const shared = listSplitwiseImports(Number.MAX_SAFE_INTEGER).expenses;
  const exclusions = listPairExclusions();
  const minorUnits = new Map(currencies.map((currency) => [currency.code, currency.minorUnit]));
  const actual = calculateActualMonth(month, transactions, shared, minorUnits, exclusions);
  const rejectedPairs = exclusions.flatMap((entry) => {
    const transaction = transactions.find((item) => item.id === entry.bankId && item.txnDate.startsWith(month));
    const expense = shared.find((item) => item.id === entry.splitwiseId);
    return transaction && expense ? [{ transaction, expense }] : [];
  });
  const showAmount = (currency: string, amountMinor: number) => {
    const unit = currencies.find((item) => item.code === currency);
    return unit ? formatMoney(amountMinor, unit) : `${currency} ${amountMinor} minor units`;
  };
  const trend = trailingMonths(month, 6).map((trendMonth) =>
    calculateMonthMetrics({ month: trendMonth, incomes, expenses, currencies, baseCurrency })
  );
  const maxCommittedCategory = Math.max(...metrics.expenseByCategory.map((item) => item.amountBaseMinor), 1);
  const maxWithOptionalCategory = Math.max(...metrics.expenseWithOptionalByCategory.map((item) => item.amountBaseMinor), 1);
  const maxCommittedGroup = Math.max(...metrics.expenseByGroup.map((item) => item.amountBaseMinor), 1);
  const maxWithOptionalGroup = Math.max(...metrics.expenseWithOptionalByGroup.map((item) => item.amountBaseMinor), 1);
  const maxCashflow = Math.max(
    ...trend.flatMap((item) => [item.incomeBaseMinor, item.expenseBaseMinor + item.optionalExpenseBaseMinor]),
    1
  );
  const netRange = chartRange(trend.flatMap((item) => [item.netBaseMinor, item.netWithOptionalBaseMinor]));
  const committedNetPoints = linePoints(
    trend.map((item) => item.netBaseMinor),
    netRange
  );
  const optionalNetPoints = linePoints(
    trend.map((item) => item.netWithOptionalBaseMinor),
    netRange
  );
  const categoryMix = createMix(
    metrics.expenseWithOptionalByCategory.map((item) => ({
      label: item.categoryName,
      amountBaseMinor: item.amountBaseMinor
    }))
  );
  const familyMix = createMix(
    metrics.expenseWithOptionalByGroup.map((item) => ({
      label: item.groupName,
      amountBaseMinor: item.amountBaseMinor
    }))
  );

  return (
    <>
      <section className="overview-heading">
        <div><h1>{formatMonthLabel(month)}</h1><p className="muted">Monthly projection · {baseCurrency.code}</p></div>
        <nav className="month-picker" aria-label="Choose month">
          <Link href={`/?month=${addMonths(month, -1)}`} aria-label="Previous month">←</Link>
          <Link href={`/?month=${currentMonthKey()}`}>Today</Link>
          <Link href={`/?month=${addMonths(month, 1)}`} aria-label="Next month">→</Link>
        </nav>
      </section>
      <section className="outlook" aria-label="Monthly projection">
        <div className="outlook-main">
          <span className="outlook-kicker">Projected net · including optional</span>
          <div className="outlook-amount"><MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.netWithOptionalBaseMinor, context: displayMoneyContext })} /></div>
          <p>After committed and optional expenses</p>
          <div className="outlook-base"><span>Net before optional</span><strong><MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.netBaseMinor, context: displayMoneyContext })} /></strong></div>
        </div>
        <div className="outlook-breakdown">
          <div className="outlook-row income-row"><span className="outlook-symbol" aria-hidden="true">↗</span><div><span>Planned income</span><strong><MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.incomeBaseMinor, context: displayMoneyContext })} /></strong></div></div>
          <div className="outlook-row expense-row"><span className="outlook-symbol" aria-hidden="true">↘</span><div><span>Committed expenses</span><strong><MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.expenseBaseMinor, context: displayMoneyContext })} /></strong></div></div>
          <div className="outlook-row optional-row"><span className="outlook-symbol" aria-hidden="true">◌</span><div><span>Optional expenses</span><strong><MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.optionalExpenseBaseMinor, context: displayMoneyContext })} /></strong></div></div>
        </div>
      </section>
      <section className="panel actual-spending" id="actual-spending" aria-labelledby="actual-spending-title">
        {params.reconciliation === "error" && <p className="alert" role="alert">Could not save that choice. Try again.</p>}
        <div className="panel-header"><div><h2 id="actual-spending-title">Observed spending</h2><p className="muted">An estimate for this month, separate from the recurring plan above. Pending bank notices are included until discarded.</p></div></div>
        {actual.totals.length === 0 ? <p className="muted">No included spending found for this month.</p> : <ul className="actual-totals">{actual.totals.map((item) => <li key={item.currency}><span>{item.currency}</span><strong>{showAmount(item.currency, item.amountMinor)}</strong></li>)}</ul>}
        <p className="muted">{actual.pending} pending bank notices · {actual.matched} possible matches · {actual.ambiguous} shared expenses need a clear match · {actual.omitted} unavailable or unsupported amounts.</p>
        <details className="actual-method"><summary>How this estimate works</summary><p className="muted">Possible matches require the same date, exact merchant, currency and amount paid, with one candidate on each side. We use your Splitwise share instead of the bank amount. You can undo a match below. Unmatched shared expenses you paid are excluded to avoid double counting. Payments, transfers and deleted entries are excluded. Amounts stay in their original currency.</p></details>
        {(actual.pairs.length > 0 || rejectedPairs.length > 0) && <details className="actual-pairs"><summary>Review possible matches</summary>
          <ul>{actual.pairs.map((pair) => <li key={`${pair.bankId}:${pair.splitwiseId}`}><div><strong>{pair.description}</strong><span>Bank {showAmount(pair.currency, pair.paidMinor)} · your share {showAmount(pair.currency, pair.owedMinor)}</span></div><form action={setPairExclusionAction}><input type="hidden" name="bank" value={pair.bankId}/><input type="hidden" name="shared" value={pair.splitwiseId}/><input type="hidden" name="month" value={month}/><button className="button button-secondary" name="exclude" value="yes" type="submit">Not the same expense</button></form></li>)}
          {rejectedPairs.map(({ transaction, expense }) => <li key={`excluded:${transaction.id}:${expense.id}`}><div><strong>{transaction.description}</strong><span>Not matched · {expense.description}</span></div><form action={setPairExclusionAction}><input type="hidden" name="bank" value={transaction.id}/><input type="hidden" name="shared" value={expense.id}/><input type="hidden" name="month" value={month}/><button className="button button-secondary" name="exclude" value="no" type="submit">Allow matching again</button></form></li>)}</ul>
        </details>}
        <p><Link href="/transactions">Review bank notices</Link> · <Link href="/splitwise">Review shared expenses and categories</Link></p>
      </section>
      <section className="overview-shortcuts" aria-label="Explore your finances">
        <Link href="/transactions"><span className="shortcut-icon" aria-hidden="true">↔</span><span><strong>Imported activity</strong><small>Review transactions</small></span><b aria-hidden="true">↗</b></Link>
        <Link href="/splitwise"><span className="shortcut-icon" aria-hidden="true">◎</span><span><strong>Splitwise</strong><small>View shared expenses</small></span><b aria-hidden="true">↗</b></Link>
        <Link href="/expenses"><span className="shortcut-icon">◫</span><span><strong>Recurring expenses</strong><small>Manage your plan</small></span><b aria-hidden="true">↗</b></Link>
      </section>
      <div className="section-heading"><div><h2>How your plan evolves</h2></div><span>Last six months</span></div>
      <section className="grid grid-2">
        <div className="panel chart-card">
          <div className="panel-header">
            <div>
              <h2>Net trend</h2>
              <p className="muted">Committed net vs net after optional expenses across the last six months.</p>
            </div>
          </div>
          <div className="line-chart-wrap">
            <div className="chart-axis-label chart-axis-label-top">
              <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: netRange.max, context: displayMoneyContext })} />
            </div>
            <svg className="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Net trend chart. Exact values are available in the six-month projection table below.">
              <line className="chart-zero-line" x1="0" x2="100" y1={lineY(0, netRange)} y2={lineY(0, netRange)} />
              <polyline className="chart-line chart-line-committed" points={committedNetPoints} />
              <polyline strokeDasharray="3 2" className="chart-line chart-line-optional" points={optionalNetPoints} />
              {trend.map((item, index) => (
                <g key={item.month}>
                  <circle className="chart-dot chart-dot-committed" cx={lineX(index, trend.length)} cy={lineY(item.netBaseMinor, netRange)} r="1.6" />
                  <circle
                    className="chart-dot chart-dot-optional"
                    cx={lineX(index, trend.length)}
                    cy={lineY(item.netWithOptionalBaseMinor, netRange)}
                    r="1.6"
                  />
                </g>
              ))}
            </svg>
            <div className="chart-axis-label chart-axis-label-bottom">
              <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: netRange.min, context: displayMoneyContext })} />
            </div>
          </div>
          <div className="chart-month-labels">
            {trend.map((item) => (
              <span key={item.month}>{formatMonthLabel(item.month)}</span>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-swatch legend-committed" /> Committed net
            </span>
            <span>
              <i className="legend-swatch legend-optional" /> With optional
            </span>
          </div>
        </div>

        <div className="panel chart-card">
          <div className="panel-header">
            <div>
              <h2>Income vs spend</h2>
              <p className="muted">Monthly income compared with committed and optional spend.</p>
            </div>
          </div>
          <div className="cashflow-chart" aria-hidden="true">
            {trend.map((item) => {
              const committedHeight = barHeight(item.expenseBaseMinor, maxCashflow);
              const optionalHeight = barHeight(item.optionalExpenseBaseMinor, maxCashflow);

              return (
                <div className="cashflow-column" key={item.month}>
                  <div className="cashflow-bars">
                    <div className="cashflow-bar cashflow-income" style={{ height: `${barHeight(item.incomeBaseMinor, maxCashflow)}%` }} />
                    <div className="cashflow-stack" aria-hidden="true">
                      <div className="cashflow-bar cashflow-optional" style={{ height: `${optionalHeight}%` }} />
                      <div className="cashflow-bar cashflow-committed" style={{ height: `${committedHeight}%` }} />
                    </div>
                  </div>
                  <span>{formatMonthLabel(item.month)}</span>
                </div>
              );
            })}
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-swatch legend-income" /> Income
            </span>
            <span>
              <i className="legend-swatch legend-committed" /> Committed
            </span>
            <span>
              <i className="legend-swatch legend-optional" /> Optional
            </span>
          </div>
        </div>
      </section>

      <details className="chart-data panel">
        <summary>View six-month projection values</summary>
        <p className="muted">Income, committed spend, optional spend, and net outcomes by month.</p>
            <div className="table-scroll" role="region" aria-label="Six-month projection" tabIndex={0}><table className="table trend-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Income</th>
                  <th scope="col">Committed</th>
                  <th scope="col">Optional</th>
                  <th scope="col">Net Base</th>
                  <th scope="col">Net With Optional</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((item) => (
                  <tr key={item.month}>
                    <td>{formatMonthLabel(item.month)}</td>
                    <td>
                      <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: item.incomeBaseMinor, context: displayMoneyContext })} />
                    </td>
                    <td>
                      <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: item.expenseBaseMinor, context: displayMoneyContext })} />
                    </td>
                    <td>
                      <MoneyStack
                        values={formatDisplayMoneyFromUyu({ amountMinor: item.optionalExpenseBaseMinor, context: displayMoneyContext })}
                      />
                    </td>
                    <td>
                      <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: item.netBaseMinor, context: displayMoneyContext })} />
                    </td>
                    <td>
                      <MoneyStack
                        values={formatDisplayMoneyFromUyu({ amountMinor: item.netWithOptionalBaseMinor, context: displayMoneyContext })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
      </details>

      <details className="overview-details" open>
        <summary><span><strong>Spending breakdown</strong></span><span className="details-indicator" aria-hidden="true">⌄</span></summary>
      <section className="grid grid-2">
        <DonutPanel
          title="Spend mix by category"
          description={`Committed plus optional expenses active in ${formatMonthLabel(month)}.`}
          emptyText="No category spend yet."
          items={categoryMix}
          context={displayMoneyContext}
        />
        <DonutPanel
          title="Spend mix by family"
          description="Same scenario, grouped by expense family."
          emptyText="No family spend yet."
          items={familyMix}
          context={displayMoneyContext}
        />
      </section>

      <section className="grid grid-2">
        <div className="panel scenario-card">
          <div className="panel-header">
            <div>
              <span className="status-pill status-committed">Committed</span>
              <h2>Base scenario</h2>
              <p className="muted">Only committed expenses active in {formatMonthLabel(month)}.</p>
            </div>
          </div>
          <div>
            {metrics.expenseByCategory.length === 0 ? (
              <p className="muted">No committed expenses yet.</p>
            ) : (
              metrics.expenseByCategory.map((item) => (
                <div className="bar-row" key={item.categoryName}>
                  <strong>{item.categoryName}</strong>
                  <div className="bar" aria-hidden="true">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.max(4, (item.amountBaseMinor / maxCommittedCategory) * 100)}%` }}
                    />
                  </div>
                  <MoneyStack
                    values={formatDisplayMoneyFromUyu({ amountMinor: item.amountBaseMinor, context: displayMoneyContext })}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel scenario-card">
          <div className="panel-header">
            <div>
              <span className="status-pill status-optional">Scenario</span>
              <h2>With optional expenses</h2>
              <p className="muted">Committed plus optional expenses active in {formatMonthLabel(month)}.</p>
            </div>
          </div>
          <div>
            {metrics.expenseWithOptionalByCategory.length === 0 ? (
              <p className="muted">No expenses yet.</p>
            ) : (
              metrics.expenseWithOptionalByCategory.map((item) => (
                <div className="bar-row" key={item.categoryName}>
                  <strong>{item.categoryName}</strong>
                  <div className="bar" aria-hidden="true">
                    <div
                      className="bar-fill bar-fill-optional"
                      style={{ width: `${Math.max(4, (item.amountBaseMinor / maxWithOptionalCategory) * 100)}%` }}
                    />
                  </div>
                  <MoneyStack
                    values={formatDisplayMoneyFromUyu({ amountMinor: item.amountBaseMinor, context: displayMoneyContext })}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="panel scenario-card">
          <div className="panel-header">
            <div>
              <span className="status-pill status-committed">Families</span>
              <h2>Committed by family</h2>
              <p className="muted">Same committed spend, grouped by expense family instead of category.</p>
            </div>
          </div>
          <div>
            {metrics.expenseByGroup.length === 0 ? (
              <p className="muted">No committed families yet.</p>
            ) : (
              metrics.expenseByGroup.map((item) => (
                <div className="bar-row" key={item.groupName}>
                  <strong>{item.groupName}</strong>
                  <div className="bar" aria-hidden="true">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.max(4, (item.amountBaseMinor / maxCommittedGroup) * 100)}%` }}
                    />
                  </div>
                  <MoneyStack
                    values={formatDisplayMoneyFromUyu({ amountMinor: item.amountBaseMinor, context: displayMoneyContext })}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel scenario-card">
          <div className="panel-header">
            <div>
              <span className="status-pill status-optional">Families</span>
              <h2>With optional by family</h2>
              <p className="muted">Committed plus optional expenses, grouped by family.</p>
            </div>
          </div>
          <div>
            {metrics.expenseWithOptionalByGroup.length === 0 ? (
              <p className="muted">No families with spend yet.</p>
            ) : (
              metrics.expenseWithOptionalByGroup.map((item) => (
                <div className="bar-row" key={item.groupName}>
                  <strong>{item.groupName}</strong>
                  <div className="bar" aria-hidden="true">
                    <div
                      className="bar-fill bar-fill-optional"
                      style={{ width: `${Math.max(4, (item.amountBaseMinor / maxWithOptionalGroup) * 100)}%` }}
                    />
                  </div>
                  <MoneyStack
                    values={formatDisplayMoneyFromUyu({ amountMinor: item.amountBaseMinor, context: displayMoneyContext })}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </section>


      </details>
    </>
  );
}


function DonutPanel({
  title,
  description,
  emptyText,
  items,
  context
}: {
  title: string;
  description: string;
  emptyText: string;
  items: MixItem[];
  context: Awaited<ReturnType<typeof getDisplayMoneyContext>>;
}) {
  return (
    <div className="panel chart-card">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="donut-layout">
          <div className="donut-chart" style={{ background: conicGradient(items) }}>
            <div className="donut-hole">
              <strong>{items.length}</strong>
              <span>groups</span>
            </div>
          </div>
          <div className="donut-legend">
            {items.map((item) => (
              <div className="donut-legend-row" key={item.label}>
                <span className="legend-swatch" style={{ background: item.color }} />
                <strong>{item.label}</strong>
                <span>{Math.round(item.percent)}%</span>
                <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: item.amountBaseMinor, context })} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type MixItem = {
  label: string;
  amountBaseMinor: number;
  percent: number;
  color: string;
};

type ChartRange = {
  min: number;
  max: number;
};

const chartColors = [
  "var(--expense)",
  "var(--optional)",
  "var(--accent)",
  "var(--net)",
  "var(--warning)",
  "var(--income)",
  "var(--line-strong)"
];

function createMix(items: Array<{ label: string; amountBaseMinor: number }>): MixItem[] {
  const filtered = items.filter((item) => item.amountBaseMinor > 0);
  const total = filtered.reduce((sum, item) => sum + item.amountBaseMinor, 0);

  return filtered.map((item, index) => ({
    ...item,
    percent: total > 0 ? (item.amountBaseMinor / total) * 100 : 0,
    color: chartColors[index % chartColors.length]
  }));
}

function conicGradient(items: MixItem[]) {
  let cursor = 0;
  const parts = items.map((item) => {
    const start = cursor;
    cursor += item.percent;
    return `${item.color} ${start}% ${cursor}%`;
  });

  return `conic-gradient(${parts.join(", ")} )`;
}

function chartRange(values: number[]): ChartRange {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);

  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }

  const padding = Math.max(Math.round((max - min) * 0.08), 1);
  return { min: min - padding, max: max + padding };
}

function lineX(index: number, total: number) {
  if (total <= 1) {
    return 50;
  }

  return (index / (total - 1)) * 100;
}

function lineY(value: number, range: ChartRange) {
  const usableHeight = 78;
  const topPadding = 10;
  const ratio = (value - range.min) / (range.max - range.min);
  return topPadding + (1 - ratio) * usableHeight;
}

function linePoints(values: number[], range: ChartRange) {
  return values.map((value, index) => `${lineX(index, values.length)},${lineY(value, range)}`).join(" ");
}

function barHeight(amountMinor: number, maxAmountMinor: number) {
  if (amountMinor <= 0 || maxAmountMinor <= 0) {
    return 0;
  }

  return Math.max(3, (amountMinor / maxAmountMinor) * 100);
}
