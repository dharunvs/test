import { activateGuardrailPolicyAction } from "../../../server-actions";
import {
  fetchGuardrailPolicies,
  fetchProjectPolicy,
  updateProjectPolicy
} from "../../../../lib/api";
import { revalidatePath } from "next/cache";

export default async function PolicyPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [policy, policyVersions] = await Promise.all([
    fetchProjectPolicy(projectId),
    fetchGuardrailPolicies({
      projectId,
      name: "default",
      includeRules: true
    }).catch(() => [])
  ]);
  const activeVersion = policyVersions.find((entry) => entry.status === "active");
  const qualityChecks = [
    { key: "build", label: "Build" },
    { key: "unit_tests", label: "Unit Tests" },
    { key: "lint", label: "Lint" },
    { key: "dependency_audit", label: "Dependency Audit" },
    { key: "integration_tests", label: "Integration Tests" }
  ] as const;

  async function updatePolicy(formData: FormData) {
    "use server";

    const protectedBranches = String(formData.get("protectedBranches") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const requiredQualityChecks = qualityChecks
      .map((check) => (String(formData.get(`qualityCheck.${check.key}`) ?? "") === "on" ? check.key : null))
      .filter((value): value is (typeof qualityChecks)[number]["key"] => Boolean(value));

    await updateProjectPolicy(projectId, {
      baseBranch: String(formData.get("baseBranch") ?? "main"),
      protectedBranches,
      autoPush: String(formData.get("autoPush") ?? "off") === "on",
      autoPr: String(formData.get("autoPr") ?? "off") === "on",
      staleThresholdMinutes: Number(formData.get("staleThresholdMinutes") ?? 120),
      cleanupAfterMergeHours: Number(formData.get("cleanupAfterMergeHours") ?? 24),
      requiredQualityChecks,
      enforceGuardrailRecheckOnPromote:
        String(formData.get("enforceGuardrailRecheckOnPromote") ?? "off") === "on"
    });
    revalidatePath(`/projects/${projectId}/policy`);
  }

  return (
    <section className="card">
      <h1>Policy: {projectId}</h1>
      <pre>{JSON.stringify(policy, null, 2)}</pre>
      <form action={updatePolicy} style={{ display: "grid", gap: 8, marginTop: 16 }}>
        <label>
          Base branch
          <input name="baseBranch" defaultValue={policy.baseBranch} />
        </label>
        <label>
          Protected branches (comma separated)
          <input
            name="protectedBranches"
            defaultValue={policy.protectedBranches.join(",")}
          />
        </label>
        <label>
          <input name="autoPush" type="checkbox" defaultChecked={policy.autoPush} /> Auto push
        </label>
        <label>
          <input name="autoPr" type="checkbox" defaultChecked={policy.autoPr} /> Auto PR
        </label>
        <label>
          Stale threshold minutes
          <input name="staleThresholdMinutes" type="number" defaultValue={policy.staleThresholdMinutes} />
        </label>
        <label>
          Cleanup after merge hours
          <input
            name="cleanupAfterMergeHours"
            type="number"
            defaultValue={policy.cleanupAfterMergeHours}
          />
        </label>
        <fieldset style={{ display: "grid", gap: 4 }}>
          <legend>Required quality checks on promote</legend>
          {qualityChecks.map((check) => (
            <label key={check.key}>
              <input
                name={`qualityCheck.${check.key}`}
                type="checkbox"
                defaultChecked={policy.requiredQualityChecks.includes(check.key)}
              />{" "}
              {check.label}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            name="enforceGuardrailRecheckOnPromote"
            type="checkbox"
            defaultChecked={policy.enforceGuardrailRecheckOnPromote}
          />{" "}
          Enforce guardrail recheck on promote
        </label>
        <button type="submit">Update Policy</button>
      </form>

      <h2 style={{ marginTop: 20 }}>Guardrail Policy Versions</h2>
      {policyVersions.length === 0 ? (
        <p>No policy versions found for this project yet.</p>
      ) : (
        <ul>
          {policyVersions.map((version) => (
            <li key={version.id} style={{ marginBottom: 10 }}>
              <strong>v{version.version}</strong> - {version.status}
              {activeVersion?.id === version.id ? " (active)" : ""}
              <div>
                Rules: {version.rules.length} | Name: {version.name}
              </div>
              {version.status !== "active" ? (
                <form action={activateGuardrailPolicyAction} style={{ marginTop: 6 }}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="version" value={version.version} />
                  <input type="hidden" name="returnPath" value={`/projects/${projectId}/policy`} />
                  <button type="submit">Activate Version</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
