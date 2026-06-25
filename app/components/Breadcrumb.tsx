"use client";

import { usePathname } from "next/navigation";
import { matchNavLink } from "@/app/components/nav-config";

export function Breadcrumb() {
  const pathname = usePathname();
  const current = matchNavLink(pathname);

  return (
    <div className="breadcrumb">
      <span>Budget</span>
      <span className="breadcrumb-sep">/</span>
      <strong>{current.label}</strong>
    </div>
  );
}
