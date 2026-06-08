import { initializePasswordAction, loginAction } from "@/src/actions/auth";
import { getCurrentSession, isPasswordConfigured } from "@/src/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { error?: string } | Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await getCurrentSession();
  if (session) {
    redirect("/");
  }

  const params = searchParams ? await searchParams : {};
  const passwordConfigured = isPasswordConfigured();

  return (
    <section className="login-shell">
      <div className="panel login-card">
        <div>
          <span className="eyebrow">Private workspace</span>
          <h1>{passwordConfigured ? "Login" : "Create your password"}</h1>
          <p className="muted">
            {passwordConfigured
              ? "Use your local BudgetSpin account to access your finance data."
              : "This will attach the current local database to the mdaneri user and protect it with a password."}
          </p>
        </div>

        {params.error ? <div className="form-error">{params.error}</div> : null}

        {passwordConfigured ? (
          <form action={loginAction} className="form-stack">
            <div className="field">
              <label htmlFor="username">User</label>
              <input id="username" name="username" defaultValue="mdaneri" autoComplete="username" required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <button className="button" type="submit">
              Login
            </button>
          </form>
        ) : (
          <form action={initializePasswordAction} className="form-stack">
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <button className="button" type="submit">
              Create password
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
