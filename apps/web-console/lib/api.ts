import "server-only";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  WEB_AUTH_ACCESS_TOKEN_COOKIE,
  missingWebAuthConfigMessage,
  resolveWebAuthMode
} from "./web-auth";

const baseUrl = process.env.BRANCHLINE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";
const apiTokenTemplate = process.env.CLERK_API_TOKEN_TEMPLATE;
const e2eBearerToken = process.env.BRANCHLINE_E2E_BEARER_TOKEN?.trim();

const ACTIVE_ORG_COOKIE = "branchline.active_org_id";
const ACTIVE_PROJECT_COOKIE = "branchline.active_project_id";

const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string()
});

const projectSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  key: z.string(),
  defaultBaseBranch: z.string().optional()
});

const organizationCreateSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().optional()
});

const projectCreateSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  key: z.string(),
  defaultBaseBranch: z.string().optional(),
  createdAt: z.string().optional()
});

const taskListItemSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  repositoryId: z.string(),
  title: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional()
});

const intentTimelineSchema = z.object({
  taskId: z.string(),
  events: z.array(
    z.object({
      eventId: z.string(),
      eventSeq: z.number(),
      timestamp: z.string(),
      prompt: z.string(),
      summary: z.string(),
      files: z.array(z.string()),
      commitId: z.string(),
      redactionLevel: z.enum(["none", "partial"]).or(z.string())
    })
  )
});

export interface ActiveScope {
  organizations: Array<z.infer<typeof organizationSchema>>;
  projects: Array<z.infer<typeof projectSchema>>;
  orgId?: string;
  projectId?: string;
}

async function getAuthHeader() {
  const authMode = resolveWebAuthMode();

  if (authMode === "github") {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(WEB_AUTH_ACCESS_TOKEN_COOKIE)?.value?.trim();
    if (sessionToken) {
      return {
        authorization: `Bearer ${sessionToken}`
      };
    }

    if (e2eBearerToken) {
      return {
        authorization: `Bearer ${e2eBearerToken}`
      };
    }

    throw new Error("Missing authenticated GitHub session token");
  }

  if (authMode === "none") {
    if (e2eBearerToken) {
      return {
        authorization: `Bearer ${e2eBearerToken}`
      };
    }

    throw new Error(missingWebAuthConfigMessage);
  }

  try {
    const sessionAuth = await auth();
    const token = await sessionAuth.getToken(
      apiTokenTemplate ? { template: apiTokenTemplate } : undefined
    );
    if (token) {
      return {
        authorization: `Bearer ${token}`
      };
    }
  } catch {
    // Fall through to deterministic e2e token fallback.
  }

  if (e2eBearerToken) {
    return {
      authorization: `Bearer ${e2eBearerToken}`
    };
  }

  throw new Error("Missing authenticated Clerk session token");
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      ...(await getAuthHeader()),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    let reason = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        if (typeof parsed.message === "string" && parsed.message.length > 0) {
          reason = parsed.message;
        } else if (typeof parsed.error === "string" && parsed.error.length > 0) {
          reason = parsed.error;
        }
      } catch {
        // Keep raw text fallback.
      }
    }
    throw new Error(`API request failed (${response.status}) for ${path}: ${reason || "unknown error"}`);
  }

  return response.json();
}

export async function fetchOrganizations() {
  const data = await requestJson("/orgs");
  return z.array(organizationSchema).parse(data);
}

export async function createOrganization(input: { name: string; slug: string }) {
  const data = await requestJson("/orgs", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return organizationCreateSchema.parse(data);
}

export async function fetchProjects(orgId: string) {
  const data = await requestJson(`/projects/${orgId}`);
  return z.array(projectSchema).parse(data);
}

export async function createProject(input: {
  orgId: string;
  name: string;
  key: string;
  baseBranch?: string;
}) {
  const data = await requestJson("/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ...input,
      baseBranch: input.baseBranch ?? "main"
    })
  });

  return projectCreateSchema.parse(data);
}

export async function fetchTasks(input: {
  projectId: string;
  limit?: number;
}) {
  const search = new URLSearchParams({
    projectId: input.projectId
  });
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }

  const data = await requestJson(`/tasks?${search.toString()}`);
  return z.array(taskListItemSchema).parse(data);
}

export async function fetchIntentTimeline(input: { taskId: string; limit?: number }) {
  const search = new URLSearchParams({
    taskId: input.taskId,
    limit: String(input.limit ?? 5)
  });

  const data = await requestJson(`/intent?${search.toString()}`);
  return intentTimelineSchema.parse(data);
}

export async function resolveActiveScope(): Promise<ActiveScope> {
  if (resolveWebAuthMode() === "none" && !e2eBearerToken) {
    return {
      organizations: [],
      projects: []
    };
  }

  const organizations = await fetchOrganizations();
  const cookieStore = await cookies();
  const orgCookie = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const orgId = organizations.find((org) => org.id === orgCookie)?.id ?? organizations[0]?.id;

  if (!orgId) {
    return {
      organizations,
      projects: []
    };
  }

  const projects = await fetchProjects(orgId);
  const projectCookie = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;
  const projectId = projects.find((project) => project.id === projectCookie)?.id ?? projects[0]?.id;

  return {
    organizations,
    projects,
    orgId,
    projectId
  };
}

export async function setActiveScopeCookies(input: { orgId: string; projectId?: string }) {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";

  cookieStore.set(ACTIVE_ORG_COOKIE, input.orgId, {
    secure,
    sameSite: "lax",
    path: "/",
    httpOnly: true
  });

  if (input.projectId) {
    cookieStore.set(ACTIVE_PROJECT_COOKIE, input.projectId, {
      secure,
      sameSite: "lax",
      path: "/",
      httpOnly: true
    });
  } else {
    cookieStore.delete(ACTIVE_PROJECT_COOKIE);
  }
}
