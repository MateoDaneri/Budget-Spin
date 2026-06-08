import { saveCurrencySettingsAction } from "@/src/actions/forms";
import { getBaseCurrency, listCurrencies } from "@/src/db/repository";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const currencies = listCurrencies();
  const baseCurrency = getBaseCurrency();

  return (
    <>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Configuration</span>
          <h1>Setup</h1>
          <p className="muted">Configure the base currency used for dashboard metrics and manual FX conversion.</p>
        </div>
      </section>

      <form action={saveCurrencySettingsAction} className="panel form-grid">
        <div className="panel-header span-full">
          <div>
            <h2>Currency settings</h2>
            <p className="muted">The base currency drives projections. Amounts can be clicked to cycle display currencies.</p>
          </div>
        </div>
        <div className="field span-2">
          <label htmlFor="baseCurrency">Base currency</label>
          <select id="baseCurrency" name="baseCurrency" defaultValue={baseCurrency.code} required>
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} - {currency.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="newCode">New code</label>
          <input id="newCode" name="newCode" maxLength={3} placeholder="GBP" />
        </div>
        <div className="field">
          <label htmlFor="newName">New name</label>
          <input id="newName" name="newName" placeholder="Pound Sterling" />
        </div>
        <div className="field">
          <label htmlFor="newSymbol">New symbol</label>
          <input id="newSymbol" name="newSymbol" placeholder="£" />
        </div>
        <div className="field">
          <label htmlFor="newMinorUnit">Minor unit</label>
          <input id="newMinorUnit" name="newMinorUnit" type="number" min="0" max="4" defaultValue="2" />
        </div>
        <button className="button" type="submit">
          Save setup
        </button>
      </form>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Currencies</h2>
            <p className="muted">Currencies available in forms and display stacks.</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Symbol</th>
              <th>Minor unit</th>
              <th>Base</th>
            </tr>
          </thead>
          <tbody>
            {currencies.map((currency) => (
              <tr key={currency.code}>
                <td>{currency.code}</td>
                <td>{currency.name}</td>
                <td>{currency.symbol}</td>
                <td>{currency.minorUnit}</td>
                <td>
                  {currency.isBase ? <span className="status-pill status-ok">Base</span> : <span className="status-pill status-muted">Display</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title">
        <div>
          <h2>Auth roadmap</h2>
          <p className="muted">Local password login is enabled for mdaneri. 2FA remains a future feature.</p>
        </div>
      </section>
      <div className="panel">
        <p className="muted">
          The current database records are owned by the mdaneri user. Sessions use an HTTP-only signed cookie. TOTP and
          backup-code 2FA are still intentionally deferred.
        </p>
      </div>
    </>
  );
}
