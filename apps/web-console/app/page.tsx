import Link from "next/link";

import { EmptyStatePanel, SectionHeader, StatCard, SurfaceCard } from "../components/ui-primitives";
import { fetchIntentTimeline, fetchTasks, resolveActiveScope } from "../lib/api";

export default async function HomePage() {
  const scope = await resolveActiveScope().catch(() => ({
    organizations: [],
    projects: [],
    orgId: undefined,
    projectId: undefined
  }));

  const tasks = scope.projectId
    ? await fetchTasks({
        projectId: scope.projectId,
        limit: 25
      }).catch(() => [])
    : [];

  const firstTask = tasks.at(0);
  const timeline = firstTask
    ? await fetchIntentTimeline({
        taskId: firstTask.id,
        limit: 5
      }).catch(() => ({ taskId: firstTask.id, events: [] }))
    : { taskId: "", events: [] };

  return (
    <section className="page-stack">
      <SurfaceCard>
        <SectionHeader
          title="Control Center"
          subtitle="Track AI intent capture health and move through the wedge workflow faster."
          action={<Link href="/timeline" className="link-button">Open Timeline</Link>}
        />
      </SurfaceCard>

      <div className="stats-grid" aria-label="Overview stats">
        <StatCard
          label="Active Scope"
          value={scope.projectId ? "Ready" : "Not Set"}
          helper={scope.projectId ? "Project selected" : "Complete onboarding to unlock"}
          tone={scope.projectId ? "success" : "neutral"}
        />
        <StatCard
          label="Project Tasks"
          value={tasks.length}
          helper="Latest 25 tasks"
          tone="primary"
        />
        <StatCard
          label="Timeline Events"
          value={timeline.events.length}
          helper={firstTask ? `From: ${firstTask.title}` : "No task selected"}
        />
      </div>

      <div className="step-grid">
        <SurfaceCard className="step-card">
          <div>
            <span className="step-index">Wedge Loop</span>
            <h2 style={{ marginTop: "4px" }}>Complete these 4 steps</h2>
          </div>
          <div className="workflow-steps">
            <div className="workflow-step">
              <div className="workflow-step-num">1</div>
              <div className="workflow-step-content">
                <div className="workflow-step-title">Login in the VS Code extension</div>
                <div className="workflow-step-desc">Authenticate your Branchline account via the extension</div>
              </div>
            </div>
            <div className="workflow-step">
              <div className="workflow-step-num">2</div>
              <div className="workflow-step-content">
                <div className="workflow-step-title">Bind workspace to project scope</div>
                <div className="workflow-step-desc">Link your VS Code workspace to an org and project</div>
              </div>
            </div>
            <div className="workflow-step">
              <div className="workflow-step-num">3</div>
              <div className="workflow-step-content">
                <div className="workflow-step-title">Start AI task and capture intent</div>
                <div className="workflow-step-desc">Run branchline.startAiTask — captures prompt, summary, and files</div>
              </div>
            </div>
            <div className="workflow-step">
              <div className="workflow-step-num">4</div>
              <div className="workflow-step-content">
                <div className="workflow-step-title">Review captured events in Timeline</div>
                <div className="workflow-step-desc">See the task-scoped intent timeline in this web console</div>
              </div>
            </div>
          </div>
          <div className="form-row">
            <Link href="/onboarding" className="link-button link-button-ghost">
              Go to Onboarding
            </Link>
            <Link href="/projects" className="link-button link-button-ghost">
              Review Projects
            </Link>
          </div>
        </SurfaceCard>

        <SurfaceCard className="step-card" tone="muted">
          <div>
            <span className="step-index">Current Focus</span>
            <h2 style={{ marginTop: "4px" }}>Wedge-only runtime</h2>
          </div>
          <p>
            This console intentionally ships only Overview, Onboarding, Projects, and Timeline in v0.1 — the minimal set to validate the wedge loop with real teams.
          </p>
          {!scope.projectId ? (
            <EmptyStatePanel
              title="Scope not set"
              description="Create or select an organization and project to unlock task and timeline data."
            />
          ) : null}
        </SurfaceCard>
      </div>
    </section>
  );
}
