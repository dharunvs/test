import Link from "next/link";

import {
  approveKnowledgeDocVersionAction,
  approveProjectPhaseRevisionAction,
  archiveKnowledgeDocAction,
  createKnowledgeDocAction,
  createProjectPhaseAction,
  proposeKnowledgeDocVersionAction,
  proposeProjectPhaseRevisionAction,
  rejectKnowledgeDocVersionAction,
  reorderProjectPhasesAction
} from "../../../server-actions";
import {
  fetchProjectKnowledgeDocs,
  fetchProjectKnowledgeOverview,
  fetchProjectPhases,
  resolveActiveScope
} from "../../../../lib/api";
import { MermaidPreview } from "../../../../components/mermaid-preview";

interface KnowledgePageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tabLink(projectId: string, tab: string) {
  return `/projects/${projectId}/knowledge?tab=${tab}`;
}

export default async function ProjectKnowledgePage({ params, searchParams }: KnowledgePageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const tab = firstParam(query.tab) ?? "overview";
  const state = firstParam(query.knowledge);
  const message = firstParam(query.message);

  const scope = await resolveActiveScope().catch(() => ({
    organizations: [],
    orgId: undefined
  }));
  const activeOrgRole =
    "organizations" in scope
      ? scope.organizations.find((org) => org.id === scope.orgId)?.role
      : undefined;
  const canApprove = activeOrgRole === "owner" || activeOrgRole === "admin";

  let overviewError: string | null = null;
  let docsError: string | null = null;
  let phasesError: string | null = null;

  const [overview, docs, phases] = await Promise.all([
    fetchProjectKnowledgeOverview(projectId).catch((error) => {
      overviewError = error instanceof Error ? error.message : "Failed to load overview";
      return null;
    }),
    fetchProjectKnowledgeDocs(projectId).catch((error) => {
      docsError = error instanceof Error ? error.message : "Failed to load docs";
      return [];
    }),
    fetchProjectPhases(projectId).catch((error) => {
      phasesError = error instanceof Error ? error.message : "Failed to load phases";
      return [];
    })
  ]);

  const moduleAndFlowDocs = docs.filter((doc) => doc.type === "module_diagram" || doc.type === "flow_diagram");

  const historyRows = [
    ...docs.flatMap((doc) =>
      doc.versions.map((version) => ({
        id: `doc-${doc.id}-${version.id}`,
        createdAt: version.createdAt,
        kind: "doc_version" as const,
        title: `${doc.title} v${version.version}`,
        status: version.approvalStatus,
        detail: `${doc.type} • proposedByType=${version.proposedByType}`,
        doc,
        version
      }))
    ),
    ...phases.flatMap((phase) =>
      phase.revisions.map((revision) => ({
        id: `phase-${phase.id}-${revision.id}`,
        createdAt: revision.createdAt,
        kind: "phase_revision" as const,
        title: `${phase.name} r${revision.revision}`,
        status: revision.approvalStatus,
        detail: `phase=${phase.key} • proposedByType=${revision.proposedByType}`,
        phase,
        revision
      }))
    )
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <section className="card" style={{ display: "grid", gap: 16 }}>
      <h1>Project Hub</h1>
      <p>
        Centralized project context for phases, architecture notes, module diagrams, and flow docs.
      </p>

      {state === "error" && message ? <p className="error-text">{message}</p> : null}
      {state && state !== "error" ? <p>Action: {state.replaceAll("_", " ")}</p> : null}
      {overviewError ? <p className="error-text">{overviewError}</p> : null}
      {docsError ? <p className="error-text">{docsError}</p> : null}
      {phasesError ? <p className="error-text">{phasesError}</p> : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={tabLink(projectId, "overview") as never}>Overview</Link>
        <Link href={tabLink(projectId, "phases") as never}>Phases</Link>
        <Link href={tabLink(projectId, "modules") as never}>Modules & Flows</Link>
        <Link href={tabLink(projectId, "history") as never}>History</Link>
      </div>

      {overview ? (
        <article style={{ display: tab === "overview" ? "grid" : "none", gap: 10 }}>
          <h2>Overview</h2>
          <p>
            Project: <strong>{overview.project.name}</strong> ({overview.project.key})
          </p>
          <p>Default branch: {overview.project.defaultBaseBranch}</p>
          <p>
            Pending approvals: docs {overview.pendingApprovals.docs} • phases {overview.pendingApprovals.phases}
          </p>
          <p>
            Phase summary: planned {overview.phaseSummary.planned} • in progress {overview.phaseSummary.inProgress} •
            blocked {overview.phaseSummary.blocked} • completed {overview.phaseSummary.completed}
          </p>

          <h3>Brief</h3>
          {overview.brief ? (
            <pre style={{ whiteSpace: "pre-wrap" }}>{overview.brief.contentMarkdown ?? "No brief content"}</pre>
          ) : (
            <p>No approved brief yet.</p>
          )}

          <h3>Architecture Notes</h3>
          {overview.architectureNotes ? (
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {overview.architectureNotes.contentMarkdown ?? "No architecture notes content"}
            </pre>
          ) : (
            <p>No approved architecture notes yet.</p>
          )}
        </article>
      ) : null}

      <article style={{ display: tab === "phases" ? "grid" : "none", gap: 12 }}>
        <h2>Phases</h2>

        <form action={createProjectPhaseAction} style={{ display: "grid", gap: 8 }}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="returnPath" value={tabLink(projectId, "phases")} />
          <label style={{ display: "grid", gap: 4 }}>
            Key
            <input name="key" placeholder="phase-1" required />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Name
            <input name="name" placeholder="Foundations" required />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Objective
            <textarea name="objective" rows={2} placeholder="What this phase should achieve" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Status
            <select name="status" defaultValue="planned">
              <option value="planned">planned</option>
              <option value="in_progress">in_progress</option>
              <option value="blocked">blocked</option>
              <option value="completed">completed</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <button type="submit">Create Phase Draft</button>
        </form>

        {phases.length === 0 ? (
          <p>No phases yet.</p>
        ) : (
          <ul>
            {phases.map((phase) => {
              const pendingRevisions = phase.revisions.filter((revision) => revision.approvalStatus === "draft");
              const latestRevision = phase.revisions[0];
              return (
                <li key={phase.id} style={{ marginBottom: 12 }}>
                  <strong>
                    {phase.name} ({phase.key})
                  </strong>
                  <div>
                    status={phase.status} • order={phase.orderIndex} • owner={phase.ownerUserId ?? "unassigned"}
                  </div>
                  <div>pending revisions: {pendingRevisions.length}</div>
                  <div>latest revision: {latestRevision ? `r${latestRevision.revision}` : "none"}</div>

                  <form action={proposeProjectPhaseRevisionAction} style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="phaseId" value={phase.id} />
                    <input type="hidden" name="baseRevision" value={String(latestRevision?.revision ?? 0)} />
                    <input type="hidden" name="returnPath" value={tabLink(projectId, "phases")} />
                    <label style={{ display: "grid", gap: 4 }}>
                      Name
                      <input name="name" defaultValue={phase.name} />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      Objective
                      <textarea name="objective" rows={2} defaultValue={phase.objective ?? ""} />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      Status
                      <select name="status" defaultValue={phase.status}>
                        <option value="planned">planned</option>
                        <option value="in_progress">in_progress</option>
                        <option value="blocked">blocked</option>
                        <option value="completed">completed</option>
                        <option value="archived">archived</option>
                      </select>
                    </label>
                    <button type="submit">Propose Phase Revision</button>
                  </form>

                  {canApprove
                    ? pendingRevisions.map((revision) => (
                        <form
                          key={revision.id}
                          action={approveProjectPhaseRevisionAction}
                          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}
                        >
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="phaseId" value={phase.id} />
                          <input type="hidden" name="revision" value={String(revision.revision)} />
                          <input type="hidden" name="expectedBaseRevision" value={String(revision.baseRevision ?? 0)} />
                          <input type="hidden" name="returnPath" value={tabLink(projectId, "phases")} />
                          <span>Approve revision r{revision.revision}</span>
                          <button type="submit">Approve</button>
                        </form>
                      ))
                    : null}
                </li>
              );
            })}
          </ul>
        )}

        {phases.length > 0 ? (
          <form action={reorderProjectPhasesAction} style={{ display: "grid", gap: 8 }}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="returnPath" value={tabLink(projectId, "phases")} />
            <label style={{ display: "grid", gap: 4 }}>
              Reorder phase IDs (comma separated)
              <input
                name="phaseIds"
                defaultValue={phases
                  .slice()
                  .sort((left, right) => left.orderIndex - right.orderIndex)
                  .map((phase) => phase.id)
                  .join(",")}
              />
            </label>
            <button type="submit">Apply Reorder</button>
          </form>
        ) : null}
      </article>

      <article style={{ display: tab === "modules" ? "grid" : "none", gap: 12 }}>
        <h2>Modules & Flows</h2>

        <form action={createKnowledgeDocAction} style={{ display: "grid", gap: 8 }}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="returnPath" value={tabLink(projectId, "modules")} />
          <label style={{ display: "grid", gap: 4 }}>
            Type
            <select name="type" defaultValue="module_diagram">
              <option value="module_diagram">module_diagram</option>
              <option value="flow_diagram">flow_diagram</option>
              <option value="architecture_notes">architecture_notes</option>
              <option value="brief">brief</option>
              <option value="decision_log">decision_log</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Title
            <input name="title" placeholder="Auth module flow" required />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Slug
            <input name="slug" placeholder="auth-module-flow" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Markdown Content
            <textarea name="contentMarkdown" rows={4} placeholder="Notes, assumptions, and context" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Mermaid Source
            <textarea
              name="mermaidSource"
              rows={6}
              placeholder={`flowchart TD\n  A[Start] --> B[Review]`}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Proposal source
            <select name="proposedByType" defaultValue="user">
              <option value="user">user</option>
              <option value="llm">llm</option>
              <option value="system">system</option>
            </select>
          </label>
          <button type="submit">Create Doc Draft</button>
        </form>

        {moduleAndFlowDocs.length === 0 ? (
          <p>No module/flow docs yet.</p>
        ) : (
          <ul>
            {moduleAndFlowDocs.map((doc) => {
              const activeVersion = doc.versions.find((entry) => entry.version === doc.activeVersion);
              const pendingVersions = doc.versions.filter((entry) => entry.approvalStatus === "draft");

              return (
                <li key={doc.id} style={{ marginBottom: 14 }}>
                  <strong>
                    {doc.title} ({doc.type})
                  </strong>
                  <div>
                    status={doc.status} • activeVersion={doc.activeVersion ?? "none"} • pending=
                    {pendingVersions.length}
                  </div>

                  {activeVersion?.mermaidSource ? (
                    <div style={{ border: "1px solid var(--stroke)", borderRadius: 10, padding: 10, marginTop: 8 }}>
                      <MermaidPreview source={activeVersion.mermaidSource} />
                    </div>
                  ) : null}

                  <form action={proposeKnowledgeDocVersionAction} style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="docId" value={doc.id} />
                    <input type="hidden" name="baseVersion" value={String(doc.activeVersion ?? 0)} />
                    <input type="hidden" name="returnPath" value={tabLink(projectId, "modules")} />
                    <label style={{ display: "grid", gap: 4 }}>
                      Markdown Content
                      <textarea name="contentMarkdown" rows={3} defaultValue={activeVersion?.contentMarkdown ?? ""} />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      Mermaid Source
                      <textarea name="mermaidSource" rows={6} defaultValue={activeVersion?.mermaidSource ?? ""} />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      Proposal source
                      <select name="proposedByType" defaultValue="user">
                        <option value="user">user</option>
                        <option value="llm">llm</option>
                        <option value="system">system</option>
                      </select>
                    </label>
                    <button type="submit">Propose New Version</button>
                  </form>

                  {canApprove
                    ? pendingVersions.map((version) => (
                        <div key={version.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          <form action={approveKnowledgeDocVersionAction}>
                            <input type="hidden" name="projectId" value={projectId} />
                            <input type="hidden" name="docId" value={doc.id} />
                            <input type="hidden" name="version" value={String(version.version)} />
                            <input type="hidden" name="expectedBaseVersion" value={String(version.baseVersion ?? 0)} />
                            <input type="hidden" name="returnPath" value={tabLink(projectId, "modules")} />
                            <button type="submit">Approve v{version.version}</button>
                          </form>
                          <form action={rejectKnowledgeDocVersionAction}>
                            <input type="hidden" name="projectId" value={projectId} />
                            <input type="hidden" name="docId" value={doc.id} />
                            <input type="hidden" name="version" value={String(version.version)} />
                            <input type="hidden" name="returnPath" value={tabLink(projectId, "modules")} />
                            <button type="submit">Reject v{version.version}</button>
                          </form>
                        </div>
                      ))
                    : null}

                  {canApprove ? (
                    <form action={archiveKnowledgeDocAction} style={{ marginTop: 8 }}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="docId" value={doc.id} />
                      <input type="hidden" name="returnPath" value={tabLink(projectId, "modules")} />
                      <button type="submit">Archive Doc</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <article style={{ display: tab === "history" ? "grid" : "none", gap: 8 }}>
        <h2>History</h2>
        {historyRows.length === 0 ? (
          <p>No history entries yet.</p>
        ) : (
          <ul>
            {historyRows.map((row) => (
              <li key={row.id}>
                <strong>{row.title}</strong>
                <div>{row.detail}</div>
                <div>
                  status={row.status} • createdAt={row.createdAt}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
