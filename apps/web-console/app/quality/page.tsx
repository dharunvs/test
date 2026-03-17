import Link from "next/link";

import {
  fetchQualityArtifacts,
  fetchQualityRun,
  fetchQualityRuns,
  fetchTasks,
  resolveActiveScope
} from "../../lib/api";

interface QualityPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function singleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function QualityPage({ searchParams }: QualityPageProps) {
  const params = await searchParams;
  const scope = await resolveActiveScope();

  if (!scope.projectId) {
    return (
      <section className="card">
        <h1>Quality Gates</h1>
        <p>Select a project in the scope selector to inspect quality outcomes.</p>
      </section>
    );
  }

  const tasks = await fetchTasks({
    projectId: scope.projectId,
    limit: 40
  });
  const selectedTaskId =
    singleParam(params.taskId) && tasks.some((task) => task.id === singleParam(params.taskId))
      ? (singleParam(params.taskId) as string)
      : undefined;
  const requestedRunId = singleParam(params.runId);
  const includeMetadata = singleParam(params.includeMetadata) === "true";

  const runs = await fetchQualityRuns({
    projectId: scope.projectId,
    taskId: selectedTaskId,
    limit: 100
  });
  const selectedRunId =
    requestedRunId && runs.some((run) => run.id === requestedRunId) ? requestedRunId : runs[0]?.id;
  const [selectedRun, artifacts] = selectedRunId
    ? await Promise.all([
      fetchQualityRun(selectedRunId).catch(() => null),
      fetchQualityArtifacts(selectedRunId, includeMetadata).catch(() => [])
    ])
    : [null, []];

  return (
    <section className="card">
      <h1>Quality Gates</h1>
      <p>Run outcomes, check-level status, and gate readiness.</p>

      <form method="GET" style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 4 }}>
          Task Filter
          <select name="taskId" defaultValue={selectedTaskId ?? ""}>
            <option value="">All tasks</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Run
          <select name="runId" defaultValue={selectedRunId ?? ""}>
            <option value="">Latest run</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id.slice(0, 8)} ({run.status})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input name="includeMetadata" type="checkbox" value="true" defaultChecked={includeMetadata} />
          Include artifact metadata
        </label>
        <button type="submit">Apply</button>
      </form>

      {runs.length === 0 ? (
        <p>No quality runs found for this scope.</p>
      ) : (
        <ul>
          {runs.map((run) => (
            <li key={run.id} style={{ marginBottom: 10 }}>
              <strong>{run.status}</strong> - {new Date(run.createdAt).toLocaleString()} - task {run.taskId}
              <div>
                Checks:{" "}
                {run.checks.map((check) => `${check.checkKey}:${check.status}`).join(", ") || "none"}
              </div>
              <div>
                <Link href={`/quality?taskId=${selectedTaskId ?? ""}&runId=${run.id}`}>Open drilldown</Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2>Selected Run Drilldown</h2>
      {selectedRun ? (
        <>
          <p>
            Run {selectedRun.id} - {selectedRun.status}
          </p>
          <p>
            Checks summary: queued {selectedRun.checksSummary?.queued ?? 0}, running{" "}
            {selectedRun.checksSummary?.running ?? 0}, passed {selectedRun.checksSummary?.passed ?? 0},
            failed {selectedRun.checksSummary?.failed ?? 0}, canceled{" "}
            {selectedRun.checksSummary?.canceled ?? 0}
          </p>
          <p>Artifacts: {selectedRun.artifactCount ?? artifacts.length}</p>
          {artifacts.length === 0 ? (
            <p>No artifacts found for this run.</p>
          ) : (
            <ul>
              {artifacts.map((artifact) => (
                <li key={artifact.id} style={{ marginBottom: 8 }}>
                  <strong>{artifact.artifactType}</strong> - {artifact.checkKey ?? "run-level"} -{" "}
                  {artifact.checkStatus ?? "n/a"} - {artifact.sizeBytes} bytes
                  <div>
                    Storage: {artifact.storageProvider}:{artifact.storageKey}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p>Select a run to inspect checks and artifacts.</p>
      )}
    </section>
  );
}
