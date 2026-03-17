import Link from "next/link";

import {
  fetchIntegrationConnectionStatus,
  fetchIntegrationConnections,
  resolveActiveScope
} from "../../lib/api";
import {
  reauthorizeIntegrationAction,
  startIntegrationOauthAction,
  unlinkIntegrationAction
} from "../server-actions";

interface IntegrationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const params = await searchParams;
  const scope = await resolveActiveScope();

  if (!scope.orgId) {
    return (
      <section className="card">
        <h1>Integrations</h1>
        <p>Select an organization in the header scope selector to manage integrations.</p>
      </section>
    );
  }

  try {
    const connections = await fetchIntegrationConnections(scope.orgId, scope.projectId);
    const statuses = await Promise.all(
      connections.map(async (connection) => ({
        id: connection.id,
        status: await fetchIntegrationConnectionStatus(connection.id, scope.orgId as string)
      }))
    );

    const statusByConnection = new Map(statuses.map((entry) => [entry.id, entry.status]));

    return (
      <section className="card">
        <h1>Integrations</h1>
        <p>
          Lifecycle controls for Slack/Linear/Jira connections. See{" "}
          <Link href={"/integrations/health" as never}>Integration Health</Link> for an operational view.
        </p>
        {params.oauth ? (
          <p>
            OAuth {String(params.oauth)} for {String(params.provider ?? "integration")}
            {params.reason ? ` (${String(params.reason)})` : ""}
          </p>
        ) : null}

        <h2>Connect Providers</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["slack", "linear", "jira"] as const).map((provider) => (
            <form key={provider} action={startIntegrationOauthAction}>
              <input type="hidden" name="orgId" value={scope.orgId} />
              <input type="hidden" name="projectId" value={scope.projectId ?? ""} />
              <input type="hidden" name="provider" value={provider} />
              <input type="hidden" name="returnPath" value="/integrations" />
              <button type="submit">Connect {provider}</button>
            </form>
          ))}
        </div>

        <h2>Existing Connections</h2>
        <ul>
          {connections.map((connection) => {
            const status = statusByConnection.get(connection.id);
            const requiresReauth = status?.requiresReauth === true;
            return (
              <li key={connection.id} style={{ marginBottom: 12 }}>
                <strong>{connection.provider}</strong> - {connection.status} - {status?.status ?? "unknown"}
                {status?.lastErrorMessage ? ` (${status.lastErrorMessage})` : ""}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {requiresReauth ? (
                    <form action={reauthorizeIntegrationAction}>
                      <input type="hidden" name="orgId" value={scope.orgId} />
                      <input type="hidden" name="connectionId" value={connection.id} />
                      <input type="hidden" name="returnPath" value="/integrations" />
                      <button type="submit">Reauthorize</button>
                    </form>
                  ) : null}
                  <form action={unlinkIntegrationAction}>
                    <input type="hidden" name="orgId" value={scope.orgId} />
                    <input type="hidden" name="connectionId" value={connection.id} />
                    <input type="hidden" name="returnPath" value="/integrations" />
                    <button type="submit">Unlink</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  } catch (error) {
    return (
      <section className="card">
        <h1>Integrations</h1>
        <p>{error instanceof Error ? error.message : "Failed to load integrations"}</p>
      </section>
    );
  }
}
