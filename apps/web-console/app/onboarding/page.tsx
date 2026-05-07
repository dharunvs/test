import Link from "next/link";

import { SectionHeader, SurfaceCard } from "../../components/ui-primitives";
import { resolveActiveScope } from "../../lib/api";
import {
  createOrganizationAction,
  createProjectAction,
  setActiveScopeAction
} from "../server-actions";

interface OnboardingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const scope = await resolveActiveScope().catch(() => ({
    organizations: [],
    projects: [],
    orgId: undefined,
    projectId: undefined
  }));
  const params = await searchParams;
  const message = firstParam(params.message);
  const orgState = firstParam(params.org);
  const projectState = firstParam(params.project);

  return (
    <section className="page-stack">
      <SurfaceCard>
        <SectionHeader
          title="Onboarding"
          subtitle="Create your organization, first project, and active scope with a guided 3-step flow."
        />
      </SurfaceCard>

      {orgState === "created" ? <p className="banner banner-success">Organization created successfully.</p> : null}
      {projectState === "created" ? <p className="banner banner-success">Project created successfully.</p> : null}
      {orgState === "error" || projectState === "error" ? (
        <p className="banner banner-error">Failed to complete onboarding action: {message ?? "Unknown error"}</p>
      ) : null}

      <div className="step-grid">
        <SurfaceCard className="step-card">
          <div className="step-header">
            <div className="step-num">1</div>
            <div className="step-header-text">
              <span className="step-index">Step 1</span>
              <h2>Create Organization</h2>
            </div>
          </div>
          <form action={createOrganizationAction} className="form-stack">
            <input type="hidden" name="returnPath" value="/onboarding" />
            <label>
              Organization Name
              <input name="name" placeholder="Branchline Labs" required />
            </label>
            <label>
              Slug
              <input name="slug" placeholder="branchline-labs" pattern="[a-z0-9-]{2,}" required />
            </label>
            <button type="submit">Create Organization</button>
          </form>
        </SurfaceCard>

        <SurfaceCard className="step-card">
          <div className="step-header">
            <div className="step-num">2</div>
            <div className="step-header-text">
              <span className="step-index">Step 2</span>
              <h2>Create Project</h2>
            </div>
          </div>
          {scope.organizations.length === 0 ? (
            <p>Create an organization first, then return here to create a project.</p>
          ) : (
            <form action={createProjectAction} className="form-stack">
              <input type="hidden" name="returnPath" value="/onboarding" />
              <label>
                Organization
                <select name="orgId" defaultValue={scope.orgId ?? scope.organizations[0]?.id} required>
                  {scope.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name} ({organization.role})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Project Name
                <input name="name" placeholder="Console MVP" required />
              </label>
              <div className="form-row">
                <label>
                  Project Key
                  <input name="key" placeholder="MVP" pattern="[A-Za-z0-9_-]{2,}" required />
                </label>
                <label>
                  Base Branch
                  <input name="baseBranch" defaultValue="main" required />
                </label>
              </div>
              <button type="submit">Create Project</button>
            </form>
          )}
        </SurfaceCard>
      </div>

      {scope.organizations.length > 0 ? (
        <SurfaceCard className="step-card">
          <div className="step-header">
            <div className="step-num">3</div>
            <div className="step-header-text">
              <span className="step-index">Step 3</span>
              <h2>Set Active Scope</h2>
            </div>
          </div>
          <form action={setActiveScopeAction} className="form-stack">
            <input type="hidden" name="returnPath" value="/onboarding" />
            <div className="form-row">
              <label>
                Organization
                <select name="orgId" defaultValue={scope.orgId ?? scope.organizations[0]?.id}>
                  {scope.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Project
                <select name="projectId" defaultValue={scope.projectId}>
                  <option value="">No project</option>
                  {scope.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit">Set Scope</button>
          </form>
        </SurfaceCard>
      ) : null}

      <SurfaceCard tone="muted">
        <p>
          Next step: start an AI task in the VS Code extension, then review captured context in{" "}
          <Link href="/timeline" style={{ color: "var(--blue-fg)", fontWeight: 600 }}>Timeline</Link>.
        </p>
      </SurfaceCard>
    </section>
  );
}
