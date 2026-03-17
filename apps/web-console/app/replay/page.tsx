import { fetchReplay, fetchTasks, resolveActiveScope } from "../../lib/api";

interface ReplayPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getSingleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function ReplayPage({ searchParams }: ReplayPageProps) {
  const params = await searchParams;
  const requestedTaskId = getSingleParam(params.taskId);
  const scope = await resolveActiveScope().catch(() => ({
    projectId: undefined
  }));
  const projectId = "projectId" in scope ? scope.projectId ?? "" : "";

  if (!projectId) {
    return (
      <section className="card">
        <h1>Replay and Provenance</h1>
        <p>Select a project in the header scope selector to load replay data.</p>
      </section>
    );
  }

  let tasks: Awaited<ReturnType<typeof fetchTasks>> = [];
  let taskError: string | null = null;

  try {
    tasks = await fetchTasks({
      projectId,
      limit: 30
    });
  } catch (error) {
    taskError = error instanceof Error ? error.message : "Failed to load project tasks";
  }

  const selectedTaskId =
    (requestedTaskId && tasks.some((task) => task.id === requestedTaskId) ? requestedTaskId : undefined) ??
    tasks[0]?.id;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);

  let replay: Awaited<ReturnType<typeof fetchReplay>> | null = null;
  let replayError: string | null = null;

  if (selectedTaskId) {
    try {
      replay = await fetchReplay(selectedTaskId);
    } catch (error) {
      replayError = error instanceof Error ? error.message : "Failed to load replay data";
    }
  }

  return (
    <section className="card">
      <h1>Replay and Provenance</h1>
      <p>Replay feature development sequences with prompts, decisions, and quality outcomes.</p>
      <div className="badge">Traceability mode</div>

      <form method="GET" style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          Task
          <select name="taskId" defaultValue={selectedTaskId ?? ""} disabled={tasks.length === 0}>
            {tasks.length === 0 ? <option value="">No tasks available</option> : null}
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} ({task.status})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={tasks.length === 0}>
          Load
        </button>
      </form>

      {selectedTask ? (
        <p style={{ marginTop: 12 }}>
          <strong>Task:</strong> {selectedTask.title} ({selectedTask.status})
        </p>
      ) : null}
      {taskError ? <p>{taskError}</p> : null}
      {!selectedTask && !taskError ? <p>No tasks found for this project yet.</p> : null}
      {replayError ? <p>{replayError}</p> : null}
      {replay ? (
        <ul>
          {replay.steps.map((step, index) => (
            <li key={`${step}-${index}`}>{step}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
