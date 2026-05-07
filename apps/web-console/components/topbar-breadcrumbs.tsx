"use client";

import { usePathname } from "next/navigation";

const LABEL_MAP: Record<string, string> = {
  "/": "Overview",
  "/onboarding": "Onboarding",
  "/projects": "Projects",
  "/timeline": "Timeline",
  "/sign-in": "Sign In",
  "/sign-up": "Sign Up"
};

export function TopbarBreadcrumbs() {
  const pathname = usePathname();
  const label = LABEL_MAP[pathname] ?? "Console";

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <span>Dashboard</span>
      <span className="sep" aria-hidden="true">/</span>
      <strong>{label}</strong>
    </nav>
  );
}
