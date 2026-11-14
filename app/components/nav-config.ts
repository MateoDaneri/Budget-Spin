export type NavIconKey = "overview" | "income" | "expenses" | "plans" | "categories" | "transactions" | "splitwise" | "balance" | "setup";

export type NavLinkConfig = {
  href: string;
  label: string;
  icon: NavIconKey;
};

export const navLinks: NavLinkConfig[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/income", label: "Income", icon: "income" },
  { href: "/expenses", label: "Expenses", icon: "expenses" },
  { href: "/balance", label: "Balance", icon: "balance" },
  { href: "/transactions", label: "Transactions", icon: "transactions" },
  { href: "/splitwise", label: "Splitwise", icon: "splitwise" },
  { href: "/plans", label: "Plans", icon: "plans" },
  { href: "/categories", label: "Categories", icon: "categories" },
  { href: "/setup", label: "Setup", icon: "setup" }
];

export function isNavLinkActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function matchNavLink(pathname: string): NavLinkConfig {
  return navLinks.find((link) => isNavLinkActive(pathname, link.href)) ?? navLinks[0];
}
