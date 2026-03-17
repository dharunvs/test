import {
  fetchOrgMembers,
  fetchProjectMembers,
  resolveActiveScope
} from "../../lib/api";
import {
  issueOrgInviteAction,
  revokeOrgInviteAction,
  updateOrgMemberRoleAction
} from "../server-actions";

export default async function TeamPage() {
  const scope = await resolveActiveScope();
  if (!scope.orgId) {
    return (
      <section className="card">
        <h1>Team and Memberships</h1>
        <p>Select an organization in the header scope selector.</p>
      </section>
    );
  }

  const [orgMembers, projectMembers] = await Promise.all([
    fetchOrgMembers(scope.orgId),
    scope.projectId ? fetchProjectMembers(scope.projectId) : Promise.resolve([])
  ]);

  return (
    <section className="card">
      <h1>Team and Memberships</h1>
      <p>Manage invites, roles, and project memberships for the selected scope.</p>

      <h2>Invite Member</h2>
      <form action={issueOrgInviteAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="orgId" value={scope.orgId} />
        <input type="hidden" name="returnPath" value="/team" />
        <input name="email" type="email" required placeholder="teammate@company.com" />
        <select name="role" defaultValue="member">
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>
        <button type="submit">Send Invite</button>
      </form>

      <h2>Organization Members</h2>
      <ul>
        {orgMembers.map((member) => (
          <li key={member.id} style={{ marginBottom: 10 }}>
            <strong>{member.user?.displayName ?? member.user?.email ?? member.userId}</strong> - {member.role} -{" "}
            {member.status}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <form action={updateOrgMemberRoleAction}>
                <input type="hidden" name="membershipId" value={member.id} />
                <input type="hidden" name="returnPath" value="/team" />
                <select name="role" defaultValue={member.role}>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="submit">Update Role</button>
              </form>
              {member.status === "invited" ? (
                <form action={revokeOrgInviteAction}>
                  <input type="hidden" name="inviteId" value={member.id} />
                  <input type="hidden" name="returnPath" value="/team" />
                  <button type="submit">Revoke Invite</button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <h2>Project Members</h2>
      {scope.projectId ? (
        <ul>
          {projectMembers.map((member) => (
            <li key={member.id}>
              {member.user?.displayName ?? member.user?.email ?? member.userId} - {member.role}
            </li>
          ))}
        </ul>
      ) : (
        <p>Select a project in the scope selector to view project-specific memberships.</p>
      )}
    </section>
  );
}

