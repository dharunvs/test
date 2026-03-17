import { normalizePolicy } from "@branchline/policy-engine";
import type { ProjectPolicyConfig } from "@branchline/shared-types";

import { toJson } from "./json.js";
import { PrismaService } from "./prisma.service.js";

export async function resolveProjectPolicy(
  prisma: PrismaService,
  projectId: string
): Promise<ProjectPolicyConfig> {
  const latest = await prisma.policySet.findFirst({
    where: {
      projectId,
      name: "default"
    },
    orderBy: {
      version: "desc"
    }
  });

  if (!latest) {
    return normalizePolicy({});
  }

  return normalizePolicy(latest.config as Partial<ProjectPolicyConfig>);
}

export async function upsertProjectPolicy(input: {
  prisma: PrismaService;
  projectId: string;
  orgId: string;
  actorUserId: string;
  partial: Partial<ProjectPolicyConfig>;
}): Promise<ProjectPolicyConfig> {
  const previous = await resolveProjectPolicy(input.prisma, input.projectId);
  const merged = normalizePolicy({
    ...previous,
    ...input.partial
  });

  const latest = await input.prisma.policySet.findFirst({
    where: {
      projectId: input.projectId,
      name: "default"
    },
    orderBy: {
      version: "desc"
    }
  });

  const nextVersion = (latest?.version ?? 0) + 1;

  await input.prisma.policySet.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      name: "default",
      version: nextVersion,
      status: "active",
      config: toJson(merged),
      createdBy: input.actorUserId
    }
  });

  return merged;
}
