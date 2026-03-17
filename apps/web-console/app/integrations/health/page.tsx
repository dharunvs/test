import {
  fetchIntegrationConnectionStatus,
  fetchIntegrationConnections,
  resolveActiveScope
} from "../../../lib/api";

export default async function IntegrationHealthPage() {
  const scope = await resolveActiveScope();
  if (!scope.orgId) {
    return (
      <section className="card">
        <h1>Integration Health</h1>
        <p>Select an organization in the scope selector.</p>
      </section>
    );
  }

  const connections = await fetchIntegrationConnections(scope.orgId, scope.projectId);
  const statuses = await Promise.all(
    connections.map(async (connection) => ({
      connection,
      status: await fetchIntegrationConnectionStatus(connection.id, scope.orgId as string)
    }))
  );

  return (
    <section className="card">
      <h1>Integration Health</h1>
      <p>Lifecycle status, reauth needs, and last known error state for provider connections.</p>

      {statuses.length === 0 ? (
        <p>No integrations connected in this scope.</p>
      ) : (
        <ul>
          {statuses.map(({ connection, status }) => (
            <li key={connection.id} style={{ marginBottom: 10 }}>
              <strong>{connection.provider}</strong> - {status.status} - healthy:{" "}
              {status.healthy === true ? "yes" : "no"}
              {status.requiresReauth ? " - requires reauth" : ""}
              {status.lastErrorMessage ? ` - ${status.lastErrorMessage}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

