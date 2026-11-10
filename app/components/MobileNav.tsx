"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/app/components/NavIcon";
import { isNavLinkActive, navLinks } from "@/app/components/nav-config";

const primaryPaths = new Set(["/", "/transactions", "/expenses", "/plans"]);

export function MobileNav() {
  const pathname = usePathname();
  const primary = navLinks.filter((link) => primaryPaths.has(link.href));
  const secondary = navLinks.filter((link) => !primaryPaths.has(link.href));
  const secondaryActive = secondary.some((link) => isNavLinkActive(pathname, link.href));

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {primary.map((link) => {
        const active = isNavLinkActive(pathname, link.href);
        return <Link key={link.href} href={link.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}><NavIcon icon={link.icon} /><span>{link.label}</span></Link>;
      })}
      <details className="mobile-more">
        <summary className={secondaryActive ? "is-active" : undefined} aria-label="More sections">
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
          <span>More</span>
        </summary>
        <div className="mobile-more-menu">
          {secondary.map((link) => {
            const active = isNavLinkActive(pathname, link.href);
            return <Link key={link.href} href={link.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined} onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}><NavIcon icon={link.icon} /><span>{link.label}</span></Link>;
          })}
        </div>
      </details>
    </nav>
  );
}
