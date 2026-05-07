"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconOnboarding() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 8 12 12 14 14" />
    </svg>
  );
}

function IconProjects() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconTimeline() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="3" />
      <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="3" />
      <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="3" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "Overview", group: "Workspace", Icon: IconHome },
  { href: "/onboarding", label: "Onboarding", group: "Workspace", Icon: IconOnboarding },
  { href: "/projects", label: "Projects", group: "Workspace", Icon: IconProjects },
  { href: "/timeline", label: "Timeline", group: "Execution", Icon: IconTimeline }
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const grouped = new Map<string, Array<(typeof NAV_ITEMS)[number]>>();

  for (const item of NAV_ITEMS) {
    const list = grouped.get(item.group) ?? [];
    list.push(item);
    grouped.set(item.group, list);
  }

  return (
    <nav aria-label="Primary navigation" className="sidebar-nav">
      {Array.from(grouped.entries()).map(([group, items]) => (
        <section key={group} className="sidebar-group" aria-label={group}>
          <p className="sidebar-group-title">{group}</p>
          <ul>
            {items.map((item) => {
              const isCurrent = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link href={item.href} aria-current={isCurrent ? "page" : undefined}>
                    <item.Icon />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
