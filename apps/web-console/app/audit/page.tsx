import {
  exportAuditLog,
  fetchQueueDepth,
  fetchRedactionPolicy,
  fetchRetentionPolicy,
  resolveActiveScope,
  verifyAuditLog
} from "../../lib/api";

export default async function AuditPage() {
  const scope = await resolveActiveScope();

  if (!scope.orgId) {
    return (
      <section className="card">
        <h1>Audit and Verification</h1>
        <p>Select an organization in the scope selector.</p>
      </section>
    );
  }

  const [auditExport, auditVerify, redactionPolicy, retentionPolicy, queueDepth] = await Promise.all([
    exportAuditLog({
      orgId: scope.orgId,
      projectId: scope.projectId
    }),
    verifyAuditLog({
      orgId: scope.orgId,
      projectId: scope.projectId
    }),
    fetchRedactionPolicy(scope.orgId),
    fetchRetentionPolicy(scope.orgId, scope.projectId),
    fetchQueueDepth().catch(() => null)
  ]);

  return (
    <section className="card">
      <h1>Audit and Verification</h1>
      <p>Hash-chain verification, retention posture, and queue reliability overview.</p>

      <h2>Audit Chain</h2>
      <ul>
        <li>Records exported: {auditExport.count}</li>
        <li>Export digest: {auditExport.digest}</li>
        <li>Audit verify valid: {auditVerify.valid ? "yes" : "no"}</li>
        <li>Mismatch count: {auditVerify.mismatchCount}</li>
      </ul>

      <h2>Redaction Policy</h2>
      <ul>
        <li>Capture prompt text: {redactionPolicy.capturePromptText ? "enabled" : "disabled"}</li>
        <li>Capture code snippets: {redactionPolicy.captureCodeSnippets ? "enabled" : "disabled"}</li>
        <li>Patterns: {redactionPolicy.redactionPatterns.join(", ") || "none"}</li>
      </ul>

      <h2>Retention Policy</h2>
      <ul>
        <li>Intent events: {retentionPolicy.intentEventsDays} days</li>
        <li>Activity events: {retentionPolicy.activityEventsDays} days</li>
        <li>Quality artifacts: {retentionPolicy.qualityArtifactsDays} days</li>
        <li>Audit logs: {retentionPolicy.auditLogsDays} days</li>
      </ul>

      <h2>Queue Depth</h2>
      {queueDepth ? (
        <ul>
          {queueDepth.queues.map((queue) => (
            <li key={queue.name}>
              {queue.name} - waiting {queue.waiting}, active {queue.active}, failed {queue.failed}
            </li>
          ))}
        </ul>
      ) : (
        <p>Queue depth endpoint unavailable for current role or environment.</p>
      )}
    </section>
  );
}

