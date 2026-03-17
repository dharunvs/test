import { fetchProvenanceGraph, fetchTasks, resolveActiveScope } from "../../lib/api";

interface ProvenancePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getSingleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function ProvenancePage({ searchParams }: ProvenancePageProps) {
  const params = await searchParams;
  const requestedTaskId = getSingleParam(params.taskId);
  const scope = await resolveActiveScope().catch(() => ({
    projectId: undefined
  }));
  const projectId = "projectId" in scope ? scope.projectId ?? "" : "";

  if (!projectId) {
    return (
      <section className="card">
        <h1>Provenance Graph</h1>
        <p>Select a project in the header scope selector to load provenance data.</p>
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

  if (!selectedTaskId) {
    return (
      <section className="card">
        <h1>Provenance Graph</h1>
        {taskError ? <p>{taskError}</p> : <p>No tasks found for this project yet.</p>}
      </section>
    );
  }

  try {
    const graph = await fetchProvenanceGraph(selectedTaskId);

    return (
      <section className="card">
        <h1>Provenance Graph</h1>

        <form method="GET" style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            Task
            <select name="taskId" defaultValue={selectedTaskId}>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title} ({task.status})
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Load</button>
        </form>

        {taskError ? <p>{taskError}</p> : null}
        <p>Task {graph.taskId}</p>
        <p>
          Nodes: {graph.counts.nodes} | Edges: {graph.counts.edges}
        </p>
        <h2>Node Types</h2>
        <ul>
          {Object.entries(
            graph.nodes.reduce<Record<string, number>>((acc, node) => {
              acc[node.type] = (acc[node.type] ?? 0) + 1;
              return acc;
            }, {})
          ).map(([type, count]) => (
            <li key={type}>
              {type}: {count}
            </li>
          ))}
        </ul>
      </section>
    );
  } catch (error) {
    return (
      <section className="card">
        <h1>Provenance Graph</h1>
        <p>{error instanceof Error ? error.message : "Failed to load provenance graph"}</p>
      </section>
    );
  }
}
