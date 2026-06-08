import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { logoutAction } from "@/src/actions/auth";
import { getCurrentSession } from "@/src/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "BudgetSpin",
  description: "Local-first personal finance planning"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <main className="page-shell">
          <header className="topbar">
            <Link className="brand-block" href="/">
              <span className="brand">BudgetSpin</span>
              <span className="brand-subtitle">Personal finance planner</span>
            </Link>
            {session ? (
              <nav className="nav" aria-label="Main navigation">
                <Link href="/">Overview</Link>
                <Link href="/income">Income</Link>
                <Link href="/expenses">Recurring</Link>
                <Link href="/plans">Plans</Link>
                <Link href="/categories">Categories</Link>
                <Link href="/setup">Setup</Link>
              </nav>
            ) : null}
            <div className="topbar-actions">
              <ThemeToggle />
              {session ? (
                <form action={logoutAction}>
                  <button className="button button-secondary" type="submit">
                    Logout
                  </button>
                </form>
              ) : null}
            </div>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
