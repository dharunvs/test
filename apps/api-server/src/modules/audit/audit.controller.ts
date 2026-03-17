import { createHash } from "node:crypto";

import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { buildAuditHash, canonicalStringify } from "../../common/audit.js";
import { PrismaService } from "../../common/prisma.service.js";
import { toJson } from "../../common/json.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const exportSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(5000).default(500)
});

const verifySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(10000).default(2000)
});

const redactionPolicySchema = z.object({
  orgId: z.string().uuid(),
  capturePromptText: z.boolean().default(true),
  captureCodeSnippets: z.boolean().default(true),
  redactionPatterns: z.array(z.string()).default([])
});

const retentionPolicySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  intentEventsDays: z.coerce.number().int().positive().default(90),
  activityEventsDays: z.coerce.number().int().positive().default(30),
  qualityArtifactsDays: z.coerce.number().int().positive().default(30),
  auditLogsDays: z.coerce.number().int().positive().default(365)
});

const orgScopedQuerySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional()
});

@Controller("audit")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin")
  @Get("export")
  async exportAudit(@Query() query: Record<string, unknown>) {
    const input = exportSchema.parse(query);

    const records = await this.prisma.auditLog.findMany({
      where: {
        orgId: input.orgId,
        projectId: input.projectId
      },
      orderBy: {
        occurredAt: "asc"
      },
      take: input.limit
    });

    const digest = createHash("sha256").update(canonicalStringify(records)).digest("hex");

    return {
      generatedAt: new Date().toISOString(),
      count: records.length,
      digest,
      records
    };
  }

  @Roles("owner", "admin")
  @Get("verify")
  async verifyAudit(@Query() query: Record<string, unknown>) {
    const input = verifySchema.parse(query);

    const records = await this.prisma.auditLog.findMany({
      where: {
        orgId: input.orgId,
        projectId: input.projectId
      },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      take: input.limit
    });

    let previousHash = "root";
    const mismatches: Array<{
      id: string;
      index: number;
      expectedHash: string;
      actualHash: string;
      eventType: string;
      occurredAt: Date;
    }> = [];

    records.forEach((record, index) => {
      const expectedHash = buildAuditHash({
        previousHash,
        orgId: record.orgId,
        projectId: record.projectId ?? undefined,
        actorUserId: record.actorUserId ?? undefined,
        eventType: record.eventType,
        entityType: record.entityType ?? undefined,
        entityId: record.entityId ?? undefined,
        payload: record.payload,
        occurredAt: record.occurredAt
      });

      if (expectedHash !== record.hash) {
        mismatches.push({
          id: record.id,
          index,
          expectedHash,
          actualHash: record.hash,
          eventType: record.eventType,
          occurredAt: record.occurredAt
        });
      }

      previousHash = record.hash;
    });

    return {
      verifiedAt: new Date().toISOString(),
      orgId: input.orgId,
      projectId: input.projectId,
      checkedRecords: records.length,
      valid: mismatches.length === 0,
      rootHash: "root",
      terminalHash: records.length > 0 ? records[records.length - 1]?.hash : null,
      mismatchCount: mismatches.length,
      firstMismatch: mismatches[0] ?? null
    };
  }

  @Roles("owner", "admin")
  @Get("tamper-check")
  async tamperCheck(@Query() query: Record<string, unknown>) {
    return this.verifyAudit(query);
  }

  @Roles("owner", "admin")
  @Get("redaction-policy")
  async getRedactionPolicy(@Query() query: Record<string, unknown>) {
    const input = orgScopedQuerySchema.parse(query);

    const policy = await this.prisma.redactionPolicy.findFirst({
      where: {
        orgId: input.orgId,
        status: "active"
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    if (!policy) {
      return {
        orgId: input.orgId,
        capturePromptText: true,
        captureCodeSnippets: true,
        redactionPatterns: [],
        source: "default"
      };
    }

    return policy;
  }

  @Roles("owner", "admin")
  @Post("redaction-policy")
  async upsertRedactionPolicy(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = redactionPolicySchema.parse(body);

    const policy = await this.prisma.$transaction(async (tx) => {
      await tx.redactionPolicy.updateMany({
        where: {
          orgId: input.orgId,
          status: "active"
        },
        data: {
          status: "inactive"
        }
      });

      return tx.redactionPolicy.create({
        data: {
          orgId: input.orgId,
          capturePromptText: input.capturePromptText,
          captureCodeSnippets: input.captureCodeSnippets,
          redactionPatterns: toJson(input.redactionPatterns),
          status: "active",
          createdBy: user.userId
        }
      });
    });

    return policy;
  }

  @Roles("owner", "admin")
  @Get("retention-policy")
  async getRetentionPolicy(@Query() query: Record<string, unknown>) {
    const input = orgScopedQuerySchema.parse(query);

    const policy = await this.prisma.retentionPolicy.findFirst({
      where: {
        orgId: input.orgId,
        projectId: input.projectId,
        status: "active"
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    if (!policy) {
      return {
        orgId: input.orgId,
        projectId: input.projectId,
        intentEventsDays: 90,
        activityEventsDays: 30,
        qualityArtifactsDays: 30,
        auditLogsDays: 365,
        source: "default"
      };
    }

    return policy;
  }

  @Roles("owner", "admin")
  @Post("retention-policy")
  async upsertRetentionPolicy(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = retentionPolicySchema.parse(body);

    const policy = await this.prisma.$transaction(async (tx) => {
      await tx.retentionPolicy.updateMany({
        where: {
          orgId: input.orgId,
          projectId: input.projectId,
          status: "active"
        },
        data: {
          status: "inactive"
        }
      });

      return tx.retentionPolicy.create({
        data: {
          orgId: input.orgId,
          projectId: input.projectId,
          intentEventsDays: input.intentEventsDays,
          activityEventsDays: input.activityEventsDays,
          qualityArtifactsDays: input.qualityArtifactsDays,
          auditLogsDays: input.auditLogsDays,
          status: "active",
          createdBy: user.userId
        }
      });
    });

    return policy;
  }

  @Roles("owner", "admin")
  @Post("retention/run")
  async runRetention(@Body() body: unknown) {
    const input = orgScopedQuerySchema.parse(body);

    const policy =
      (await this.prisma.retentionPolicy.findFirst({
        where: {
          orgId: input.orgId,
          projectId: input.projectId,
          status: "active"
        },
        orderBy: {
          updatedAt: "desc"
        }
      })) ??
      (await this.prisma.retentionPolicy.findFirst({
        where: {
          orgId: input.orgId,
          projectId: null,
          status: "active"
        },
        orderBy: {
          updatedAt: "desc"
        }
      }));

    const effective = policy ?? {
      intentEventsDays: 90,
      activityEventsDays: 30,
      qualityArtifactsDays: 30,
      auditLogsDays: 365
    };

    const now = Date.now();
    const intentCutoff = new Date(now - effective.intentEventsDays * 24 * 60 * 60 * 1000);
    const activityCutoff = new Date(now - effective.activityEventsDays * 24 * 60 * 60 * 1000);
    const artifactCutoff = new Date(now - effective.qualityArtifactsDays * 24 * 60 * 60 * 1000);

    const [intentDeleted, activityDeleted, artifactDeleted] = await this.prisma.$transaction([
      this.prisma.intentEvent.deleteMany({
        where: {
          orgId: input.orgId,
          projectId: input.projectId,
          occurredAt: {
            lt: intentCutoff
          }
        }
      }),
      this.prisma.activityEvent.deleteMany({
        where: {
          orgId: input.orgId,
          projectId: input.projectId,
          occurredAt: {
            lt: activityCutoff
          }
        }
      }),
      this.prisma.qualityArtifact.deleteMany({
        where: {
          createdAt: {
            lt: artifactCutoff
          },
          run: {
            orgId: input.orgId,
            projectId: input.projectId
          }
        }
      })
    ]);

    return {
      runAt: new Date().toISOString(),
      policySource: policy ? "active_policy" : "default",
      deleted: {
        intentEvents: intentDeleted.count,
        activityEvents: activityDeleted.count,
        qualityArtifacts: artifactDeleted.count
      },
      auditLogsRetained: true
    };
  }
}
