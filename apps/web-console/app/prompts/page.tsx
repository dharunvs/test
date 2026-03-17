import { fetchPromptTemplates, fetchPromptUsageAnalytics, resolveActiveScope } from "../../lib/api";

interface PromptsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function singleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function PromptsPage({ searchParams }: PromptsPageProps) {
  const params = await searchParams;
  const scope = await resolveActiveScope();

  if (!scope.orgId) {
    return (
      <section className="card">
        <h1>Prompt Library</h1>
        <p>Select an organization in the scope selector to inspect prompt usage analytics.</p>
      </section>
    );
  }

  const sinceDays = Number(singleParam(params.sinceDays) ?? "30");
  const templates = await fetchPromptTemplates(scope.orgId, scope.projectId);
  const analytics = await fetchPromptUsageAnalytics({
    orgId: scope.orgId,
    projectId: scope.projectId,
    sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : 30
  });

  return (
    <section className="card">
      <h1>Prompt Library</h1>
      <p>Template inventory and adoption metrics for the active scope.</p>

      <form method="GET" style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          Since days
          <input name="sinceDays" type="number" min={1} max={365} defaultValue={analytics.sinceDays} />
        </label>
        <button type="submit">Apply</button>
      </form>

      <h2>Summary</h2>
      <ul>
        <li>Total templates: {templates.length}</li>
        <li>Total usage records: {analytics.totalUsage}</li>
      </ul>

      <h2>Templates</h2>
      {templates.length === 0 ? (
        <p>No prompt templates found for this scope.</p>
      ) : (
        <ul>
          {templates.map((template) => (
            <li key={template.id}>
              <strong>{template.name}</strong> ({template.slug}) - {template.category} - latest v
              {template.versions[0]?.version ?? 1}
            </li>
          ))}
        </ul>
      )}

      <h2>Adoption</h2>
      {analytics.templates.length === 0 ? (
        <p>No usage telemetry found for this period.</p>
      ) : (
        <ul>
          {analytics.templates.map((entry) => (
            <li key={entry.templateId}>
              <strong>{entry.name}</strong> - usages {entry.usageCount} - avg rating{" "}
              {entry.averageRating ?? "n/a"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
