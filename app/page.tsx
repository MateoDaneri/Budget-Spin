import Link from "next/link";
import { MoneyStack } from "@/app/components/MoneyStack";
import { getBaseCurrency, listCurrencies, listIncomeItems, listRecurringExpenses } from "@/src/db/repository";
import { addMonths, currentMonthKey, formatMonthLabel, trailingMonths } from "@/src/finance/dates";
import { formatDisplayMoneyFromUyu, getDisplayMoneyContext } from "@/src/finance/display-money";
import { calculateMonthMetrics } from "@/src/finance/metrics";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { month?: string } | Promise<{ month?: string }>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const month = params.month ?? currentMonthKey();
  const currencies = listCurrencies();
  const baseCurrency = getBaseCurrency();
  const displayMoneyContext = await getDisplayMoneyContext(currencies);
  const incomes = listIncomeItems();
  const expenses = listRecurringExpenses();
  const metrics = calculateMonthMetrics({ month, incomes, expenses, currencies, baseCurrency });
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
      <section className="page-hero">
        <div>
          <span className="eyebrow">Overview</span>
          <h1>{formatMonthLabel(month)}</h1>
          <p className="muted">
            Projected monthly view. Amounts are normalized to {baseCurrency.code}; click amounts to cycle currencies.
          </p>
        </div>
        <div className="nav">
          <Link href={`/?month=${addMonths(month, -1)}`}>Previous</Link>
          <Link href={`/?month=${currentMonthKey()}`}>Current</Link>
          <Link href={`/?month=${addMonths(month, 1)}`}>Next</Link>
        </div>
      </section>

      <section className="grid grid-4">
        <div className="panel metric-card metric-card-income">
          <span className="metric-label">Income planned</span>
          <strong className="metric-value">
            <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.incomeBaseMinor, context: displayMoneyContext })} />
          </strong>
          <p className="scenario-note">Income occurrences active in this month.</p>
        </div>
        <div className="panel metric-card metric-card-expense">
          <span className="metric-label">Committed spend</span>
          <strong className="metric-value">
            <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.expenseBaseMinor, context: displayMoneyContext })} />
          </strong>
          <p className="scenario-note">Recurring expenses marked committed.</p>
        </div>
        <div className="panel metric-card metric-card-optional">
          <span className="metric-label">Optional scenario</span>
          <strong className="metric-value">
            <MoneyStack
              values={formatDisplayMoneyFromUyu({ amountMinor: metrics.optionalExpenseBaseMinor, context: displayMoneyContext })}
            />
          </strong>
          <p className="scenario-note">Extra planned expenses if you apply them.</p>
        </div>
        <div className="panel metric-card metric-card-net">
          <span className="metric-label">Net after optional</span>
          <strong className="metric-value">
            <MoneyStack
              values={formatDisplayMoneyFromUyu({ amountMinor: metrics.netWithOptionalBaseMinor, context: displayMoneyContext })}
            />
          </strong>
          <p className="scenario-note">
            Committed-only net:{" "}
            <MoneyStack values={formatDisplayMoneyFromUyu({ amountMinor: metrics.netBaseMinor, context: displayMoneyContext })} />
          </p>
        </div>
      </section>

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
            <svg className="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Net trend chart">
              <line className="chart-zero-line" x1="0" x2="100" y1={lineY(0, netRange)} y2={lineY(0, netRange)} />
              <polyline className="chart-line chart-line-committed" points={committedNetPoints} />
              <polyline className="chart-line chart-line-optional" points={optionalNetPoints} />
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
          <div className="cashflow-chart">
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

      <section>
        <div>
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Six-month projection</h2>
                <p className="muted">Income, committed spend, optional spend, and net outcomes by month.</p>
              </div>
            </div>
            <table className="table trend-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Income</th>
                  <th>Committed</th>
                  <th>Optional</th>
                  <th>Net Base</th>
                  <th>Net With Optional</th>
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
            </table>
          </div>
        </div>
      </section>
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
