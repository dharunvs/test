"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  acknowledgeTaskHandoff,
  approveProjectKnowledgeDocVersion,
  approveProjectPhaseRevision,
  archiveProjectKnowledgeDoc,
  activateGuardrailPolicyVersion,
  claimConflictOwnership,
  createOrganization,
  createProjectKnowledgeDoc,
  createProjectPhase,
  createProject,
  issueOrgInvite,
  proposeProjectKnowledgeDocVersion,
  proposeProjectPhaseRevision,
  rejectProjectKnowledgeDocVersion,
  reorderProjectPhases,
  reauthorizeIntegrationConnection,
  reconcileGithubState,
  revokeOrgInvite,
  setActiveScopeCookies,
  startIntegrationOauth,
  updateOrgMemberRole,
  unlinkIntegrationConnection
} from "../lib/api";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function buildRedirectPath(returnPath: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return `${returnPath}${returnPath.includes("?") ? "&" : "?"}${search}`;
}

export async function setActiveScopeAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "/");

  if (!orgId) {
    return;
  }

  await setActiveScopeCookies({
    orgId,
    projectId: projectId || undefined
  });

  redirect((returnPath || "/") as never);
}

export async function createOrganizationAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const returnPath = String(formData.get("returnPath") ?? "/onboarding");

  if (!name || !slug) {
    redirect(`${returnPath}?org=error&message=${encodeURIComponent("Name and slug are required")}` as never);
  }

  let organizationId: string;
  try {
    const organization = await createOrganization({
      name,
      slug
    });
    organizationId = organization.id;
  } catch (error) {
    redirect(`${returnPath}?org=error&message=${encodeURIComponent(getErrorMessage(error))}` as never);
  }

  await setActiveScopeCookies({
    orgId: organizationId
  });
  revalidatePath("/onboarding");
  redirect(`${returnPath}?org=created&orgId=${organizationId}` as never);
}

export async function createProjectAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim().toUpperCase();
  const baseBranch = String(formData.get("baseBranch") ?? "main").trim();
  const returnPath = String(formData.get("returnPath") ?? "/onboarding");

  if (!orgId || !name || !key) {
    redirect(
      `${returnPath}?project=error&message=${encodeURIComponent("Organization, name, and key are required")}` as never
    );
  }

  let projectId: string;
  try {
    const project = await createProject({
      orgId,
      name,
      key,
      baseBranch: baseBranch || "main"
    });
    projectId = project.id;
  } catch (error) {
    redirect(`${returnPath}?project=error&message=${encodeURIComponent(getErrorMessage(error))}` as never);
  }

  await setActiveScopeCookies({
    orgId,
    projectId
  });
  revalidatePath("/onboarding");
  redirect(`${returnPath}?project=created&projectId=${projectId}` as never);
}

export async function startIntegrationOauthAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "/integrations");

  if (!orgId || (provider !== "slack" && provider !== "linear" && provider !== "jira")) {
    redirect("/integrations?oauth=error&reason=invalid_request" as never);
  }

  const response = await startIntegrationOauth({
    orgId,
    projectId: projectId || undefined,
    provider,
    returnPath
  });

  redirect(response.authorizeUrl as never);
}

export async function reauthorizeIntegrationAction(formData: FormData) {
  const connectionId = String(formData.get("connectionId") ?? "");
  const orgId = String(formData.get("orgId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "/integrations");

  if (!orgId || !connectionId) {
    redirect("/integrations?oauth=error&reason=invalid_request" as never);
  }

  const response = await reauthorizeIntegrationConnection({
    connectionId,
    orgId,
    returnPath
  });

  redirect(response.authorizeUrl as never);
}

export async function unlinkIntegrationAction(formData: FormData) {
  const connectionId = String(formData.get("connectionId") ?? "");
  const orgId = String(formData.get("orgId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "/integrations");

  if (!orgId || !connectionId) {
    return;
  }

  await unlinkIntegrationConnection({
    connectionId,
    orgId
  });

  revalidatePath("/integrations");
  redirect(returnPath as never);
}

export async function issueOrgInviteAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "member");
  const returnPath = String(formData.get("returnPath") ?? "/team");

  if (!orgId || !email) {
    redirect("/team?invite=error&reason=invalid_request" as never);
  }

  await issueOrgInvite({
    orgId,
    email,
    role: role as "owner" | "admin" | "member" | "viewer"
  });

  revalidatePath("/team");
  redirect(`${returnPath}?invite=sent` as never);
}

export async function revokeOrgInviteAction(formData: FormData) {
  const inviteId = String(formData.get("inviteId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "/team");

  if (!inviteId) {
    return;
  }

  await revokeOrgInvite(inviteId);
  revalidatePath("/team");
  redirect(returnPath as never);
}

export async function updateOrgMemberRoleAction(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "");
  const role = String(formData.get("role") ?? "member");
  const returnPath = String(formData.get("returnPath") ?? "/team");

  if (!membershipId) {
    return;
  }

  await updateOrgMemberRole(
    membershipId,
    role as "owner" | "admin" | "member" | "viewer"
  );
  revalidatePath("/team");
  redirect(returnPath as never);
}

export async function reconcileGithubAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "/repositories");

  await reconcileGithubState({
    orgId: orgId || undefined,
    projectId: projectId || undefined
  });
  revalidatePath("/repositories");
  redirect(returnPath as never);
}

export async function activateGuardrailPolicyAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const version = Number(formData.get("version") ?? Number.NaN);
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/policy`);

  if (!projectId || !Number.isFinite(version)) {
    return;
  }

  await activateGuardrailPolicyVersion({
    projectId,
    version
  });

  revalidatePath(`/projects/${projectId}/policy`);
  redirect(returnPath as never);
}

export async function acknowledgeHandoffAction(formData: FormData) {
  const handoffId = String(formData.get("handoffId") ?? "");
  const notesRaw = String(formData.get("notes") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? `/tasks?taskId=${taskId}`);

  if (!handoffId) {
    return;
  }

  await acknowledgeTaskHandoff(handoffId, notesRaw.trim() || undefined);
  revalidatePath("/tasks");
  redirect(returnPath as never);
}

export async function claimConflictOwnershipAction(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const scopeValue = String(formData.get("scopeValue") ?? "");
  const scopeType = String(formData.get("scopeType") ?? "file");
  const ttlMinutes = Number(formData.get("ttlMinutes") ?? 120);
  const returnPath = String(formData.get("returnPath") ?? `/tasks?taskId=${taskId}`);

  if (!orgId || !projectId || !taskId || !scopeValue) {
    return;
  }

  await claimConflictOwnership({
    orgId,
    projectId,
    taskId,
    scopeType,
    scopeValue,
    ttlMinutes: Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 120
  });

  revalidatePath("/tasks");
  redirect(returnPath as never);
}

export async function createKnowledgeDocAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const type = String(formData.get("type") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const contentMarkdown = String(formData.get("contentMarkdown") ?? "").trim();
  const mermaidSource = String(formData.get("mermaidSource") ?? "").trim();
  const changeSummary = String(formData.get("changeSummary") ?? "").trim();
  const proposedByType = String(formData.get("proposedByType") ?? "user");
  const sourceTaskId = String(formData.get("sourceTaskId") ?? "").trim();
  const sourceAiRunId = String(formData.get("sourceAiRunId") ?? "").trim();
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge`);

  if (!projectId || !title || !type) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: "projectId, type and title are required"
      }) as never
    );
  }

  try {
    await createProjectKnowledgeDoc(projectId, {
      type: type as "brief" | "module_diagram" | "flow_diagram" | "architecture_notes" | "decision_log",
      title,
      slug: slug || undefined,
      contentMarkdown: contentMarkdown || undefined,
      mermaidSource: mermaidSource || undefined,
      changeSummary: changeSummary || undefined,
      proposedByType: proposedByType as "user" | "llm" | "system",
      sourceTaskId: sourceTaskId || undefined,
      sourceAiRunId: sourceAiRunId || undefined
    });
  } catch (error) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: getErrorMessage(error)
      }) as never
    );
  }

  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "doc_created" }) as never);
}

export async function proposeKnowledgeDocVersionAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const docId = String(formData.get("docId") ?? "");
  const contentMarkdown = String(formData.get("contentMarkdown") ?? "").trim();
  const mermaidSource = String(formData.get("mermaidSource") ?? "").trim();
  const changeSummary = String(formData.get("changeSummary") ?? "").trim();
  const proposedByType = String(formData.get("proposedByType") ?? "user");
  const sourceTaskId = String(formData.get("sourceTaskId") ?? "").trim();
  const sourceAiRunId = String(formData.get("sourceAiRunId") ?? "").trim();
  const baseVersion = Number(formData.get("baseVersion") ?? Number.NaN);
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge`);

  if (!projectId || !docId) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: "projectId and docId are required"
      }) as never
    );
  }

  try {
    const result = await proposeProjectKnowledgeDocVersion(projectId, docId, {
      contentMarkdown: contentMarkdown || undefined,
      mermaidSource: mermaidSource || undefined,
      changeSummary: changeSummary || undefined,
      proposedByType: proposedByType as "user" | "llm" | "system",
      sourceTaskId: sourceTaskId || undefined,
      sourceAiRunId: sourceAiRunId || undefined,
      baseVersion: Number.isFinite(baseVersion) ? baseVersion : undefined
    });

    if (!result.created) {
      redirect(
        buildRedirectPath(returnPath, {
          knowledge: "conflict",
          message: `Version conflict. Latest approved version is ${result.latestApprovedVersion}.`
        }) as never
      );
    }
  } catch (error) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: getErrorMessage(error)
      }) as never
    );
  }

  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "version_proposed" }) as never);
}

export async function approveKnowledgeDocVersionAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const docId = String(formData.get("docId") ?? "");
  const version = Number(formData.get("version") ?? Number.NaN);
  const expectedBaseVersion = Number(formData.get("expectedBaseVersion") ?? Number.NaN);
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge`);

  if (!projectId || !docId || !Number.isFinite(version)) {
    return;
  }

  const result = await approveProjectKnowledgeDocVersion(
    projectId,
    docId,
    version,
    Number.isFinite(expectedBaseVersion) ? expectedBaseVersion : undefined
  );

  if (!result.approved) {
    const message =
      result.reason === "version_conflict" && typeof result.latestApprovedVersion === "number"
        ? `Version conflict. Latest approved version is ${result.latestApprovedVersion}.`
        : `Version ${result.version} is not pending approval.`;
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "conflict",
        message
      }) as never
    );
  }

  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "version_approved" }) as never);
}

export async function rejectKnowledgeDocVersionAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const docId = String(formData.get("docId") ?? "");
  const version = Number(formData.get("version") ?? Number.NaN);
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge`);

  if (!projectId || !docId || !Number.isFinite(version)) {
    return;
  }

  const result = await rejectProjectKnowledgeDocVersion(projectId, docId, version);
  if (!result.rejected) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "conflict",
        message: `Version ${result.version} is not pending approval.`
      }) as never
    );
  }

  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "version_rejected" }) as never);
}

export async function archiveKnowledgeDocAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const docId = String(formData.get("docId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge`);

  if (!projectId || !docId) {
    return;
  }

  await archiveProjectKnowledgeDoc(projectId, docId);
  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "doc_archived" }) as never);
}

export async function createProjectPhaseAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const objective = String(formData.get("objective") ?? "").trim();
  const status = String(formData.get("status") ?? "planned");
  const ownerUserId = String(formData.get("ownerUserId") ?? "").trim();
  const orderIndex = Number(formData.get("orderIndex") ?? Number.NaN);
  const plannedStartAt = String(formData.get("plannedStartAt") ?? "").trim();
  const plannedEndAt = String(formData.get("plannedEndAt") ?? "").trim();
  const completedAt = String(formData.get("completedAt") ?? "").trim();
  const proposedByType = String(formData.get("proposedByType") ?? "user");
  const sourceTaskId = String(formData.get("sourceTaskId") ?? "").trim();
  const sourceAiRunId = String(formData.get("sourceAiRunId") ?? "").trim();
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge?tab=phases`);

  if (!projectId || !key || !name) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: "projectId, key and name are required"
      }) as never
    );
  }

  try {
    await createProjectPhase(projectId, {
      key,
      name,
      objective: objective || undefined,
      status: status as "planned" | "in_progress" | "blocked" | "completed" | "archived",
      ownerUserId: ownerUserId || undefined,
      orderIndex: Number.isFinite(orderIndex) ? orderIndex : undefined,
      plannedStartAt: plannedStartAt || undefined,
      plannedEndAt: plannedEndAt || undefined,
      completedAt: completedAt || undefined,
      proposedByType: proposedByType as "user" | "llm" | "system",
      sourceTaskId: sourceTaskId || undefined,
      sourceAiRunId: sourceAiRunId || undefined
    });
  } catch (error) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: getErrorMessage(error)
      }) as never
    );
  }

  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "phase_created" }) as never);
}

export async function proposeProjectPhaseRevisionAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const phaseId = String(formData.get("phaseId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const objective = String(formData.get("objective") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const ownerUserId = String(formData.get("ownerUserId") ?? "").trim();
  const orderIndex = Number(formData.get("orderIndex") ?? Number.NaN);
  const plannedStartAt = String(formData.get("plannedStartAt") ?? "").trim();
  const plannedEndAt = String(formData.get("plannedEndAt") ?? "").trim();
  const completedAt = String(formData.get("completedAt") ?? "").trim();
  const changeSummary = String(formData.get("changeSummary") ?? "").trim();
  const proposedByType = String(formData.get("proposedByType") ?? "user");
  const sourceTaskId = String(formData.get("sourceTaskId") ?? "").trim();
  const sourceAiRunId = String(formData.get("sourceAiRunId") ?? "").trim();
  const baseRevision = Number(formData.get("baseRevision") ?? Number.NaN);
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge?tab=phases`);

  if (!projectId || !phaseId) {
    return;
  }

  let result: Awaited<ReturnType<typeof proposeProjectPhaseRevision>>;
  try {
    result = await proposeProjectPhaseRevision(projectId, phaseId, {
      name: name || undefined,
      objective: objective || undefined,
      status: status
        ? (status as "planned" | "in_progress" | "blocked" | "completed" | "archived")
        : undefined,
      ownerUserId: ownerUserId || undefined,
      orderIndex: Number.isFinite(orderIndex) ? orderIndex : undefined,
      plannedStartAt: plannedStartAt || undefined,
      plannedEndAt: plannedEndAt || undefined,
      completedAt: completedAt || undefined,
      changeSummary: changeSummary || undefined,
      proposedByType: proposedByType as "user" | "llm" | "system",
      sourceTaskId: sourceTaskId || undefined,
      sourceAiRunId: sourceAiRunId || undefined,
      baseRevision: Number.isFinite(baseRevision) ? baseRevision : undefined
    });
  } catch (error) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: getErrorMessage(error)
      }) as never
    );
  }

  if (!result.created) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "conflict",
        message: `Revision conflict. Latest approved revision is ${result.latestApprovedRevision}.`
      }) as never
    );
  }

  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "phase_revision_proposed" }) as never);
}

export async function approveProjectPhaseRevisionAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const phaseId = String(formData.get("phaseId") ?? "");
  const revision = Number(formData.get("revision") ?? Number.NaN);
  const expectedBaseRevision = Number(formData.get("expectedBaseRevision") ?? Number.NaN);
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge?tab=phases`);

  if (!projectId || !phaseId || !Number.isFinite(revision)) {
    return;
  }

  let result: Awaited<ReturnType<typeof approveProjectPhaseRevision>>;
  try {
    result = await approveProjectPhaseRevision(
      projectId,
      phaseId,
      revision,
      Number.isFinite(expectedBaseRevision) ? expectedBaseRevision : undefined
    );
  } catch (error) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: getErrorMessage(error)
      }) as never
    );
  }

  if (!result.approved) {
    const message =
      result.reason === "revision_conflict" && typeof result.latestApprovedRevision === "number"
        ? `Revision conflict. Latest approved revision is ${result.latestApprovedRevision}.`
        : `Revision ${result.revision} is not pending approval.`;
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "conflict",
        message
      }) as never
    );
  }

  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "phase_revision_approved" }) as never);
}

export async function reorderProjectPhasesAction(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const phaseIdsRaw = String(formData.get("phaseIds") ?? "");
  const returnPath = String(formData.get("returnPath") ?? `/projects/${projectId}/knowledge?tab=phases`);

  if (!projectId) {
    return;
  }

  const phaseIds = phaseIdsRaw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (phaseIds.length === 0) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: "No phase ids provided for reordering"
      }) as never
    );
  }

  try {
    await reorderProjectPhases(projectId, phaseIds);
  } catch (error) {
    redirect(
      buildRedirectPath(returnPath, {
        knowledge: "error",
        message: getErrorMessage(error)
      }) as never
    );
  }
  revalidatePath(`/projects/${projectId}/knowledge`);
  redirect(buildRedirectPath(returnPath, { knowledge: "phases_reordered" }) as never);
}
