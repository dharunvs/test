import { EmptyStatePanel, PillTabs, SectionHeader, StatCard, SurfaceCard } from "../../components/ui-primitives";
import { fetchIntentTimeline, fetchTasks, resolveActiveScope } from "../../lib/api";

interface TimelinePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function TimelinePage({ searchParams }: TimelinePageProps) {
  const scope = await resolveActiveScope();
  const params = await searchParams;

  if (!scope.projectId) {
    return (
      <section className="page-stack">
        <SurfaceCard>
          <SectionHeader title="Intent Timeline" subtitle="Select a project in scope to load task-scoped events." />
        </SurfaceCard>
        <EmptyStatePanel
          title="No project selected"
          description="Choose a project from the top scope selector, then return to timeline."
        />
      </section>
    );
  }

  const tasks = await fetchTasks({
    projectId: scope.projectId,
    limit: 25
  });

  const firstTask = tasks.at(0);
  if (!firstTask) {
    return (
      <section className="page-stack">
        <SurfaceCard>
          <SectionHeader title="Intent Timeline" subtitle="Task-scoped feed for AI intent events." />
        </SurfaceCard>
        <EmptyStatePanel
          title="No tasks found"
          description="Start a task from the VS Code extension first, then load timeline entries here."
        />
      </section>
    );
  }

  const selectedTaskIdParam = firstParam(params.taskId);
  const selectedTaskId =
    selectedTaskIdParam && tasks.some((task) => task.id === selectedTaskIdParam)
      ? selectedTaskIdParam
      : firstTask.id;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? firstTask;

  const timeline = await fetchIntentTimeline({
    taskId: selectedTask.id,
    limit: 5
  });

  const latestEvent = timeline.events.at(0);

  return (
    <section className="page-stack">
      <SurfaceCard>
        <SectionHeader
          title="Intent Timeline"
          subtitle="Review the last 5 AI intent events for a selected task."
        />
      </SurfaceCard>

      <div className="timeline-layout">
        <SurfaceCard className="timeline-card">
          <PillTabs
            tabs={[
              { id: "events", label: "Events", active: true },
              { id: "tasks", label: "Tasks" },
              { id: "status", label: "Status" }
            ]}
          />

          <form method="GET" className="form-row">
            <label>
              Task
              <select name="taskId" defaultValue={selectedTask.id}>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} ({task.status})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Limit
              <input value="5" readOnly />
            </label>
            <div>
              <button type="submit">Load Timeline</button>
            </div>
          </form>

          {timeline.events.length === 0 ? (
            <EmptyStatePanel
              title="No intent events"
              description="No intent events captured yet for this task. Start a task from the extension to capture events."
            />
          ) : (
            <div className="timeline-events">
              {timeline.events.map((event, index) => (
                <div key={event.eventId} className="timeline-event-row">
                  <div className="timeline-event-marker">
                    <div className="timeline-event-dot" />
                    {index < timeline.events.length - 1 && (
                      <div className="timeline-event-line" />
                    )}
                  </div>
                  <article className="event-card">
                    <div className="event-head">
                      <span className="event-seq">#{event.eventSeq}</span>
                      <span className="event-time">{new Date(event.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="event-lines">
                      <div className="event-field">
                        <span className="event-field-label">Commit</span>
                        <span className="commit-badge">{event.commitId}</span>
                      </div>
                      <div className="event-field">
                        <span className="event-field-label">Prompt</span>
                        <p className="event-field-value">{event.prompt || "(redacted or empty)"}</p>
                      </div>
                      <div className="event-field">
                        <span className="event-field-label">AI Summary</span>
                        <p className="event-field-value">{event.summary || "(redacted or empty)"}</p>
                      </div>
                      {event.files.length > 0 && (
                        <div className="event-field">
                          <span className="event-field-label">Files</span>
                          <div className="file-pills">
                            {event.files.map((f) => (
                              <span key={f} className="file-pill">{f}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="event-field">
                        <span className="event-field-label">Redaction</span>
                        <span className={`redaction-badge redaction-${event.redactionLevel}`}>
                          {event.redactionLevel}
                        </span>
                      </div>
                    </div>
                  </article>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        <aside className="side-rail">
          <StatCard label="Selected Task" value={selectedTask.title} helper={selectedTask.status} tone="primary" />
          <StatCard label="Events Loaded" value={timeline.events.length} helper="Most recent first" />
          <StatCard
            label="Latest Commit"
            value={latestEvent?.commitId ?? "none"}
            helper={latestEvent ? `Seq #${latestEvent.eventSeq}` : "No events"}
            tone={latestEvent ? "success" : "neutral"}
          />
          <SurfaceCard tone="muted">
            <p className="note-text">
              Timeline in v0.1 is task-scoped and intentionally concise: commit ID, prompt, AI summary, file list, and redaction level.
            </p>
          </SurfaceCard>
        </aside>
      </div>
    </section>
  );
}
