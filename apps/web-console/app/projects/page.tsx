import { EmptyStatePanel, SectionHeader, SurfaceCard } from "../../components/ui-primitives";
import { resolveActiveScope } from "../../lib/api";

export default async function ProjectsPage() {
  const scope = await resolveActiveScope().catch((error) => ({
    organizations: [],
    projects: [],
    orgId: undefined,
    projectId: undefined,
    error: error instanceof Error ? error.message : "Unknown error"
  }));

  const projects = "projects" in scope ? scope.projects : [];

  return (
    <section className="page-stack">
      <SurfaceCard>
        <SectionHeader
          title="Projects"
          subtitle="Manage project scope used by extension task creation and timeline capture."
        />
      </SurfaceCard>

      {"error" in scope ? <p className="banner banner-error">{scope.error}</p> : null}

      {projects.length === 0 ? (
        <EmptyStatePanel
          title="No projects available"
          description="Create a project from the Onboarding page, then return here to set your active scope."
        />
      ) : (
        <div className="project-grid">
          {projects.map((project) => {
            const isActive = project.id === scope.projectId;
            return (
              <article key={project.id} className="project-card">
                <div className="project-card-header">
                  <h2>{project.name}</h2>
                  <span className="key-badge">{project.key}</span>
                </div>
                <div>
                  <div className="meta-row">
                    <span>Default branch</span>
                    <strong>{project.defaultBaseBranch ?? "main"}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Status</span>
                    <span className={isActive ? "status-badge status-badge-active" : "status-badge"}>
                      {isActive ? "Active" : "Available"}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
