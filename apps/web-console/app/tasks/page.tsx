import Link from "next/link";

import {
  fetchBranchAutomationStatus,
  fetchTask,
  fetchTaskConflicts,
  fetchTaskHandoffs,
  fetchTaskPrSlices,
  fetchTaskReviewDigest,
  fetchTasks,
  resolveActiveScope
} from "../../lib/api";
import {
  acknowledgeHandoffAction,
  claimConflictOwnershipAction
} from "../server-actions";

interface TasksPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function singleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const scope = await resolveActiveScope();

  if (!scope.projectId) {
    return (
      <section className="card">
        <h1>Tasks and Branches</h1>
        <p>Select a project in the header scope selector to load task workflows.</p>
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
      : tasks[0]?.id;

  if (!selectedTaskId) {
    return (
      <section className="card">
        <h1>Tasks and Branches</h1>
        <p>No tasks found for this project.</p>
      </section>
    );
  }

  const task = await fetchTask(selectedTaskId);
  const [conflicts, handoffs, branchAutomation, prSlices, reviewDigest] = await Promise.all([
    fetchTaskConflicts(selectedTaskId),
    fetchTaskHandoffs(selectedTaskId),
    Promise.all(task.branches.map((branch) => fetchBranchAutomationStatus(branch.id))),
    fetchTaskPrSlices(selectedTaskId),
    fetchTaskReviewDigest(selectedTaskId)
  ]);

  return (
    <section className="card">
      <h1>Tasks and Branches</h1>
      <form method="GET" style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          Task
          <select name="taskId" defaultValue={selectedTaskId}>
            {tasks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} ({item.status})
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Load</button>
      </form>

      <p>
        <strong>{task.title}</strong> - {task.status}
      </p>
      <p>
        Conflicts: {conflicts.length} | Handoffs: {handoffs.length}
      </p>

      <h2>Reviewer Digest</h2>
      <p>
        Risk: <strong>{reviewDigest.riskLevel}</strong> | Recommendation:{" "}
        <strong>{reviewDigest.recommendedAction}</strong>
      </p>
      <p>
        Intent events: {reviewDigest.summary.intentEvents} | Activity events: {reviewDigest.summary.activityEvents} |
        Open conflicts: {reviewDigest.summary.openConflicts} | Missing required checks:{" "}
        {reviewDigest.summary.missingRequiredChecks}
      </p>
      <p>Digest hash: {reviewDigest.digestHash}</p>
      <p>Reason codes: {reviewDigest.reasonCodes.join(", ") || "none"}</p>

      <h2>Conflict Guidance</h2>
      {conflicts.length === 0 ? (
        <p>No active conflicts for this task.</p>
      ) : (
        <ul>
          {conflicts.map((conflict) => {
            const primaryFile = conflict.filePaths[0];
            return (
              <li key={conflict.id} style={{ marginBottom: 12 }}>
                <strong>{conflict.severity}</strong> - score {conflict.score}
                <div>Reasons: {conflict.reasonCodes?.join(", ") ?? "none"}</div>
                <div>Suggested action: {conflict.suggestedAction ?? "continue_with_watch"}</div>
                <div>Files: {conflict.filePaths.join(", ") || "none"}</div>
                {scope.orgId && primaryFile ? (
                  <form action={claimConflictOwnershipAction} style={{ marginTop: 6 }}>
                    <input type="hidden" name="orgId" value={scope.orgId} />
                    <input type="hidden" name="projectId" value={scope.projectId} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="scopeType" value="file" />
                    <input type="hidden" name="scopeValue" value={primaryFile} />
                    <input type="hidden" name="ttlMinutes" value={120} />
                    <input type="hidden" name="returnPath" value={`/tasks?taskId=${task.id}`} />
                    <button type="submit">Claim {primaryFile}</button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h2>Handoffs</h2>
      {handoffs.length === 0 ? (
        <p>No handoffs are available for this task.</p>
      ) : (
        <ul>
          {handoffs.map((handoff) => (
            <li key={handoff.id} style={{ marginBottom: 12 }}>
              <strong>{handoff.summary}</strong> - {new Date(handoff.createdAt).toLocaleString()}
              <form action={acknowledgeHandoffAction} style={{ display: "grid", gap: 6, marginTop: 6 }}>
                <input type="hidden" name="handoffId" value={handoff.id} />
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="returnPath" value={`/tasks?taskId=${task.id}`} />
                <input name="notes" placeholder="Optional acknowledgment notes" />
                <button type="submit">Acknowledge Handoff</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2>Branches</h2>
      <ul>
        {branchAutomation.map((status) => (
          <li key={status.branchId} style={{ marginBottom: 10 }}>
            <strong>{status.branchName}</strong> - blockers:{" "}
            {status.blockingReasons.length > 0 ? status.blockingReasons.join(", ") : "none"}
            {status.pullRequest ? (
              <>
                {" "}
                - PR #{status.pullRequest.number} ({status.pullRequest.status})
              </>
            ) : null}
          </li>
        ))}
      </ul>

      <h2>PR Slices</h2>
      {prSlices.length === 0 ? (
        <p>No PR slices generated yet for this task.</p>
      ) : (
        <ul>
          {prSlices.map((slice) => (
            <li key={slice.id} style={{ marginBottom: 10 }}>
              <strong>
                #{slice.pullRequest.number} / slice {slice.sliceOrder}: {slice.title}
              </strong>{" "}
              - risk {slice.riskLevel} ({slice.status})
              <div>Branch: {slice.pullRequest.branch.name}</div>
              <div>Files: {slice.filePaths.join(", ") || "none"}</div>
            </li>
          ))}
        </ul>
      )}

      <h2>Drilldowns</h2>
      <ul>
        <li>
          <Link href={`/provenance?taskId=${task.id}`}>Open provenance graph</Link>
        </li>
        <li>
          <Link href={`/replay?taskId=${task.id}`}>Open replay timeline</Link>
        </li>
      </ul>
    </section>
  );
}
