import { createHash } from "node:crypto";

import { PrismaService } from "./prisma.service.js";
import { toJson } from "./json.js";

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalizeJson(record[key]);
      return acc;
    }, {});
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function buildAuditHash(input: {
  previousHash: string;
  orgId: string;
  projectId?: string;
  actorUserId?: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload: unknown;
  occurredAt: Date;
}): string {
  return createHash("sha256")
    .update(
      [
        input.previousHash,
        input.orgId,
        input.projectId ?? "-",
        input.actorUserId ?? "-",
        input.eventType,
        input.entityType ?? "-",
        input.entityId ?? "-",
        canonicalStringify(input.payload ?? {}),
        input.occurredAt.toISOString()
      ].join("|")
    )
    .digest("hex");
}

export async function appendAuditLog(input: {
  prisma: PrismaService;
  orgId: string;
  projectId?: string;
  actorUserId?: string;
  actorType: "user" | "system";
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: unknown;
}) {
  const previous = await input.prisma.auditLog.findFirst({
    where: {
      orgId: input.orgId
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const occurredAt = new Date();
  const hash = buildAuditHash({
    previousHash: previous?.hash ?? "root",
    orgId: input.orgId,
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload ?? {},
    occurredAt
  });

  return input.prisma.auditLog.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: toJson(input.payload),
      occurredAt,
      hash
    }
  });
}
