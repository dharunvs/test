import {
  fetchGithubInstallationStatus,
  fetchRepositories,
  resolveActiveScope
} from "../../lib/api";
import { reconcileGithubAction } from "../server-actions";

export default async function RepositoriesPage() {
  const scope = await resolveActiveScope();
  if (!scope.orgId) {
    return (
      <section className="card">
        <h1>Repositories and GitHub Installations</h1>
        <p>Select an organization in the header scope selector.</p>
      </section>
    );
  }

  const [installationStatus, repositories] = await Promise.all([
    fetchGithubInstallationStatus(scope.orgId, scope.projectId),
    scope.projectId ? fetchRepositories(scope.projectId) : Promise.resolve([])
  ]);

  return (
    <section className="card">
      <h1>Repositories and GitHub Installations</h1>
      <p>GitHub installation sync status and repository/project bindings.</p>

      <form action={reconcileGithubAction} style={{ marginBottom: 12 }}>
        <input type="hidden" name="orgId" value={scope.orgId} />
        <input type="hidden" name="projectId" value={scope.projectId ?? ""} />
        <input type="hidden" name="returnPath" value="/repositories" />
        <button type="submit">Run Reconciliation</button>
      </form>

      <h2>Installations</h2>
      <ul>
        {installationStatus.installations.map((installation) => (
          <li key={installation.id}>
            {installation.accountLogin} ({installation.accountType}) - installation{" "}
            {installation.githubInstallationId}
            {installation.uninstalledAt ? " - uninstalled" : " - active"}
          </li>
        ))}
      </ul>

      <h2>Scoped Repositories</h2>
      {repositories.length > 0 ? (
        <ul>
          {repositories.map((repository) => (
            <li key={repository.id}>
              <strong>{repository.fullName}</strong> - {repository.provider} - default{" "}
              {repository.defaultBranch ?? "main"}
            </li>
          ))}
        </ul>
      ) : (
        <p>No repositories are mapped to the active project scope yet.</p>
      )}

      <h2>Installation Mapping</h2>
      <ul>
        {installationStatus.repositories.map((repository) => (
          <li key={repository.id}>
            {repository.fullName} - installation {repository.githubInstallationId ?? "unknown"}
          </li>
        ))}
      </ul>
    </section>
  );
}

