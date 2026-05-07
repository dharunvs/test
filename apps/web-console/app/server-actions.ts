"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  createOrganization,
  createProject,
  setActiveScopeCookies
} from "../lib/api";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
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
