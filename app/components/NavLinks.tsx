"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/app/components/NavIcon";
import { isNavLinkActive, navLinks } from "@/app/components/nav-config";

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Main navigation">
      {navLinks.map((link) => {
        const active = isNavLinkActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <NavIcon icon={link.icon} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
