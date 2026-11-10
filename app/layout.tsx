import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { NavLinks } from "@/app/components/NavLinks";
import { MobileNav } from "@/app/components/MobileNav";
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

  if (!session) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body>
          <div className="auth-shell">
            <header className="auth-topbar">
              <Link className="brand-block" href="/">
                <span className="brand">BudgetSpin</span>
                <span className="brand-subtitle">Personal finance planner</span>
              </Link>
              <ThemeToggle />
            </header>
            {children}
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div className="app-layout">
          <aside className="sidebar">
            <Link className="brand-block sidebar-brand" href="/">
              <span className="brand">BudgetSpin</span>
              <span className="brand-subtitle">Personal finance planner</span>
            </Link>
            <NavLinks />
            <div className="sidebar-footer">
              <ThemeToggle />
              <form action={logoutAction}>
                <button className="button button-secondary" type="submit">
                  Logout
                </button>
              </form>
            </div>
          </aside>
          <div className="mobile-navigation"><MobileNav /></div>
          <main className="app-content" id="main-content" tabIndex={-1}>
            <div className="content-inner">
              <Breadcrumb />
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
