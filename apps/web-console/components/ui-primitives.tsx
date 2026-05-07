import type { ReactNode } from "react";

function cx(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  tone?: "default" | "muted";
}

export function SurfaceCard({ children, className, tone = "default" }: SurfaceCardProps) {
  return <section className={cx("surface-card", tone === "muted" && "surface-card-muted", className)}>{children}</section>;
}

interface StatCardProps {
  label: string;
  value: string | number;
  helper?: string;
  tone?: "neutral" | "primary" | "success";
}

export function StatCard({ label, value, helper, tone = "neutral" }: StatCardProps) {
  return (
    <article className={cx("stat-card", `stat-card-${tone}`)}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {helper ? <p className="stat-helper">{helper}</p> : null}
    </article>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

interface PillTabsProps {
  tabs: Array<{ id: string; label: string; active?: boolean }>;
}

export function PillTabs({ tabs }: PillTabsProps) {
  return (
    <div className="pill-tabs" role="tablist" aria-label="View tabs">
      {tabs.map((tab) => (
        <span key={tab.id} className={cx("pill-tab", tab.active && "pill-tab-active")} role="tab" aria-selected={tab.active ? "true" : "false"}>
          {tab.label}
        </span>
      ))}
    </div>
  );
}

interface EmptyStatePanelProps {
  title: string;
  description: string;
}

export function EmptyStatePanel({ title, description }: EmptyStatePanelProps) {
  return (
    <section className="empty-state-panel" role="status">
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  );
}
