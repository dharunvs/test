import { fetchPivotReports, resolveActiveScope } from "../../lib/api";

export default async function PivotPage() {
  const scope = await resolveActiveScope().catch(() => ({
    projectId: undefined
  }));
  const projectId = "projectId" in scope ? scope.projectId ?? "" : "";

  if (!projectId) {
    return (
      <section className="card">
        <h1>Pivot Reports</h1>
        <p>Select a project in the scope selector to inspect stale-context reports.</p>
      </section>
    );
  }

  const reports = await fetchPivotReports(projectId, 20);
  const openCount = reports.reduce(
    (count, report) => count + report.staleReports.filter((entry) => entry.status === "open").length,
    0
  );

  return (
    <section className="card">
      <h1>Pivot Reports</h1>
      <p>Track stale context and context-shift remediation requirements.</p>
      <p>
        Reports: {reports.length} | Open stale entries: {openCount}
      </p>
      {reports.length === 0 ? (
        <p>No pivot reports found for the active project.</p>
      ) : (
        <ul>
          {reports.map((report) => (
            <li key={report.id} style={{ marginBottom: 12 }}>
              <strong>{report.title}</strong> - {new Date(report.createdAt).toLocaleString()}
              <div>{report.description ?? "No description"}</div>
              <div>
                Open stale entries: {report.staleReports.filter((entry) => entry.status === "open").length}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
