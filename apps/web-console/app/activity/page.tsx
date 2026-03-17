import Link from "next/link";

import {
  fetchPivotReports,
  fetchPresence,
  fetchQualityRuns,
  fetchRealtimeLatency,
  fetchTaskConflicts,
  fetchTasks,
  resolveActiveScope
} from "../../lib/api";
import { LiveActivityStream } from "./live-activity-stream";

export default async function ActivityPage() {
  const scope = await resolveActiveScope().catch(() => ({
    projectId: undefined
  }));
  const projectId = "projectId" in scope ? scope.projectId ?? "" : "";

  let presence: Awaited<ReturnType<typeof fetchPresence>> = [];
  let error: string | null = null;
  let recentTaskId: string | undefined;
  let conflictCount = 0;
  let qualityPassed = 0;
  let qualityFailed = 0;
  let staleContextCount = 0;
  let realtimeP95Ms = 0;
  let realtimeWithinTarget = true;

  if (projectId) {
    try {
      presence = await fetchPresence(projectId);
      const tasks = await fetchTasks({
        projectId,
        limit: 10
      });
      recentTaskId = tasks[0]?.id;

      if (recentTaskId) {
        const conflicts = await fetchTaskConflicts(recentTaskId);
        conflictCount = conflicts.length;
      }

      const qualityRuns = await fetchQualityRuns({
        projectId,
        limit: 40
      });
      qualityPassed = qualityRuns.filter((run) => run.status === "passed").length;
      qualityFailed = qualityRuns.filter((run) => run.status === "failed").length;

      const pivotReports = await fetchPivotReports(projectId, 10);
      staleContextCount = pivotReports.reduce(
        (sum, report) => sum + report.staleReports.filter((entry) => entry.status === "open").length,
        0
      );

      const latency = await fetchRealtimeLatency({
        projectId,
        windowMinutes: 60
      });
      realtimeP95Ms = latency.p95Ms;
      realtimeWithinTarget = latency.withinTarget;
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
    }
  } else {
    error = "Select a project in the header scope selector to load activity.";
  }

  return (
    <section className="card">
      <h1>Live Activity</h1>
      <p>Displays active contributors, file focus, AI run status, and conflict alerts.</p>
      <div className="badge">WebSocket stream: activity.user_state_changed</div>
      <div style={{ marginTop: 12 }}>
        <strong>Dashboard</strong>
        <ul>
          <li>Active presence: {presence.length}</li>
          <li>Current task conflicts: {conflictCount}</li>
          <li>
            Quality outcomes: passed {qualityPassed}, failed {qualityFailed}
          </li>
          <li>Open stale-context reports: {staleContextCount}</li>
          <li>
            Realtime propagation p95: {realtimeP95Ms}ms ({realtimeWithinTarget ? "within target" : "above target"})
          </li>
        </ul>
        {recentTaskId ? (
          <p>
            Drilldown: <Link href={`/provenance?taskId=${recentTaskId}`}>Provenance</Link> |{" "}
            <Link href={`/replay?taskId=${recentTaskId}`}>Replay</Link>
          </p>
        ) : null}
      </div>
      {error ? <p>{error}</p> : null}
      {projectId ? <LiveActivityStream projectId={projectId} initialPresence={presence} /> : null}
    </section>
  );
}
