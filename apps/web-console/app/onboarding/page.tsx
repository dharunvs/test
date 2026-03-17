import Link from "next/link";

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
    <section className="card" style={{ display: "grid", gap: 16 }}>
      <h1>Onboarding</h1>
      <p>Create your organization and first project without using manual API calls.</p>

      {orgState === "created" ? <p>Organization created successfully.</p> : null}
      {projectState === "created" ? <p>Project created successfully.</p> : null}
      {orgState === "error" || projectState === "error" ? (
        <p className="error-text">Failed to complete onboarding action: {message ?? "Unknown error"}</p>
      ) : null}

      <article style={{ display: "grid", gap: 8 }}>
        <h2>Create Organization</h2>
        <form action={createOrganizationAction} style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <input type="hidden" name="returnPath" value="/onboarding" />
          <label style={{ display: "grid", gap: 4 }}>
            Organization Name
            <input name="name" placeholder="Branchline Labs" required />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Slug
            <input name="slug" placeholder="branchline-labs" pattern="[a-z0-9-]{2,}" required />
          </label>
          <button type="submit">Create Organization</button>
        </form>
      </article>

      <article style={{ display: "grid", gap: 8 }}>
        <h2>Create Project</h2>
        {scope.organizations.length === 0 ? (
          <p>Create an organization first, then come back to create a project.</p>
        ) : (
          <form action={createProjectAction} style={{ display: "grid", gap: 8, maxWidth: 520 }}>
            <input type="hidden" name="returnPath" value="/onboarding" />
            <label style={{ display: "grid", gap: 4 }}>
              Organization
              <select name="orgId" defaultValue={scope.orgId ?? scope.organizations[0]?.id} required>
                {scope.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name} ({organization.role})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Project Name
              <input name="name" placeholder="Console MVP" required />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Project Key
              <input name="key" placeholder="MVP" pattern="[A-Za-z0-9_-]{2,}" required />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Base Branch
              <input name="baseBranch" defaultValue="main" required />
            </label>
            <button type="submit">Create Project</button>
          </form>
        )}
      </article>

      {scope.organizations.length > 0 ? (
        <article style={{ display: "grid", gap: 8 }}>
          <h2>Set Active Scope</h2>
          <form action={setActiveScopeAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <input type="hidden" name="returnPath" value="/onboarding" />
            <label style={{ display: "grid", gap: 4 }}>
              Organization
              <select name="orgId" defaultValue={scope.orgId ?? scope.organizations[0]?.id}>
                {scope.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
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
            <button type="submit">Set Scope</button>
          </form>
        </article>
      ) : null}

      <p>
        Next step: <Link href="/repositories">link repositories</Link> and continue to{" "}
        <Link href="/tasks">task workflows</Link>.
      </p>
    </section>
  );
}
