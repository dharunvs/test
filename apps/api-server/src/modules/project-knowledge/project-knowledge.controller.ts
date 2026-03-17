import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Get,
  Post,
  Query
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { appendAuditLog } from "../../common/audit.js";
import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const mermaidHeaderPattern = /^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram)\b/;

const projectPathSchema = z.object({
  projectId: z.string().uuid()
});

const docPathSchema = z.object({
  projectId: z.string().uuid(),
  docId: z.string().uuid()
});

const docVersionPathSchema = z.object({
  projectId: z.string().uuid(),
  docId: z.string().uuid(),
  version: z.coerce.number().int().positive()
});

const phasePathSchema = z.object({
  projectId: z.string().uuid(),
  phaseId: z.string().uuid()
});

const phaseRevisionPathSchema = z.object({
  projectId: z.string().uuid(),
  phaseId: z.string().uuid(),
  revision: z.coerce.number().int().positive()
});

const optionalTrimmedString = () =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1).optional()
  );

const optionalNullableTrimmedString = () =>
  z.preprocess(
    (value) => {
      if (value === null) {
        return null;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      return value;
    },
    z.string().min(1).nullable().optional()
  );

const optionalDateString = () =>
  z.preprocess(
    (value) => {
      if (value === null) {
        return null;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      return value;
    },
    z.string().datetime().nullable().optional()
  );

const knowledgeDocTypeSchema = z.enum([
  "brief",
  "module_diagram",
  "flow_diagram",
  "architecture_notes",
  "decision_log"
]);

const proposedByTypeSchema = z.enum(["user", "llm", "system"]);

const createDocSchema = z.object({
  type: knowledgeDocTypeSchema,
  slug: optionalTrimmedString(),
  title: z.string().min(2).max(160),
  contentMarkdown: optionalTrimmedString(),
  mermaidSource: optionalTrimmedString(),
  changeSummary: optionalTrimmedString(),
  proposedByType: proposedByTypeSchema.default("user"),
  sourceTaskId: z.string().uuid().optional(),
  sourceAiRunId: z.string().uuid().optional()
});

const createDocVersionSchema = z.object({
  contentMarkdown: optionalTrimmedString(),
  mermaidSource: optionalTrimmedString(),
  changeSummary: optionalTrimmedString(),
  proposedByType: proposedByTypeSchema.default("user"),
  sourceTaskId: z.string().uuid().optional(),
  sourceAiRunId: z.string().uuid().optional(),
  baseVersion: z.number().int().nonnegative().optional()
});

const projectPhaseStatusSchema = z.enum([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "archived"
]);

const createPhaseSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(2).max(160),
  objective: optionalNullableTrimmedString(),
  status: projectPhaseStatusSchema.default("planned"),
  ownerUserId: optionalNullableTrimmedString(),
  orderIndex: z.number().int().nonnegative().optional(),
  plannedStartAt: optionalDateString(),
  plannedEndAt: optionalDateString(),
  completedAt: optionalDateString(),
  proposedByType: proposedByTypeSchema.default("user"),
  sourceTaskId: z.string().uuid().optional(),
  sourceAiRunId: z.string().uuid().optional()
});

const createPhaseRevisionSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  objective: optionalNullableTrimmedString(),
  status: projectPhaseStatusSchema.optional(),
  ownerUserId: optionalNullableTrimmedString(),
  orderIndex: z.number().int().nonnegative().optional(),
  plannedStartAt: optionalDateString(),
  plannedEndAt: optionalDateString(),
  completedAt: optionalDateString(),
  changeSummary: optionalTrimmedString(),
  proposedByType: proposedByTypeSchema.default("user"),
  sourceTaskId: z.string().uuid().optional(),
  sourceAiRunId: z.string().uuid().optional(),
  baseRevision: z.number().int().nonnegative().optional()
});

const reorderPhasesSchema = z.object({
  phaseIds: z.array(z.string().uuid()).min(1)
});

const overviewQuerySchema = z.object({
  includeArchived: z.coerce.boolean().optional().default(false)
});

const approveOptionsSchema = z.object({
  expectedBaseVersion: z.number().int().nonnegative().optional(),
  expectedBaseRevision: z.number().int().nonnegative().optional()
});

const phasePayloadSchema = z.object({
  name: z.string().trim().min(2).max(160),
  objective: z.string().nullable(),
  status: projectPhaseStatusSchema,
  ownerUserId: z.string().nullable(),
  orderIndex: z.number().int().nonnegative(),
  plannedStartAt: z.string().datetime().nullable(),
  plannedEndAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable()
});

const diagramDocTypes = new Set<z.infer<typeof knowledgeDocTypeSchema>>([
  "module_diagram",
  "flow_diagram"
]);

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid datetime value: ${value}`);
  }
  return parsed;
}

function normalizeMermaidSource(value: string): string {
  let source = value.trim();

  if (source.startsWith("```")) {
    const lines = source.split(/\r?\n/);
    if (/^```(?:mermaid)?\s*$/i.test(lines[0] ?? "")) {
      lines.shift();
    }
    const lastLine = lines.at(-1)?.trim();
    if (lastLine === "```") {
      lines.pop();
    }
    source = lines.join("\n").trim();
  }

  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine || !mermaidHeaderPattern.test(firstLine)) {
    throw new BadRequestException(
      "Invalid mermaidSource header. Expected one of: flowchart, graph, sequenceDiagram, classDiagram, erDiagram, stateDiagram"
    );
  }

  return source;
}

function normalizeMermaidIfPresent(mermaidSource?: string): string | undefined {
  if (!mermaidSource) {
    return undefined;
  }
  return normalizeMermaidSource(mermaidSource);
}

function isDiagramDocType(type: z.infer<typeof knowledgeDocTypeSchema>): boolean {
  return diagramDocTypes.has(type);
}

function mapKnowledgeVersion(version: {
  id: string;
  version: number;
  contentMarkdown: string | null;
  mermaidSource: string | null;
  changeSummary: string | null;
  approvalStatus: string;
  proposedBy: string | null;
  proposedByType: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  sourceTaskId: string | null;
  sourceAiRunId: string | null;
  baseVersion: number | null;
  createdAt: Date;
}) {
  return {
    id: version.id,
    version: version.version,
    contentMarkdown: version.contentMarkdown,
    mermaidSource: version.mermaidSource,
    changeSummary: version.changeSummary,
    approvalStatus: version.approvalStatus,
    proposedBy: version.proposedBy,
    proposedByType: version.proposedByType,
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt?.toISOString() ?? null,
    sourceTaskId: version.sourceTaskId,
    sourceAiRunId: version.sourceAiRunId,
    baseVersion: version.baseVersion,
    createdAt: version.createdAt.toISOString()
  };
}

function mapPhaseRevision(revision: {
  id: string;
  revision: number;
  payload: Prisma.JsonValue;
  approvalStatus: string;
  proposedBy: string | null;
  proposedByType: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  sourceTaskId: string | null;
  sourceAiRunId: string | null;
  baseRevision: number | null;
  createdAt: Date;
}) {
  return {
    id: revision.id,
    revision: revision.revision,
    payload: revision.payload,
    approvalStatus: revision.approvalStatus,
    proposedBy: revision.proposedBy,
    proposedByType: revision.proposedByType,
    approvedBy: revision.approvedBy,
    approvedAt: revision.approvedAt?.toISOString() ?? null,
    sourceTaskId: revision.sourceTaskId,
    sourceAiRunId: revision.sourceAiRunId,
    baseRevision: revision.baseRevision,
    createdAt: revision.createdAt.toISOString()
  };
}

@Controller("projects/:projectId")
export class ProjectKnowledgeController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get("knowledge/overview")
  async getOverview(
    @Param("projectId") projectId: string,
    @Query() query: Record<string, unknown>
  ) {
    const { projectId: validatedProjectId } = projectPathSchema.parse({ projectId });
    const options = overviewQuerySchema.parse(query);

    const project = await this.ensureProject(validatedProjectId);

    const [docs, phases, pendingDocApprovals, pendingPhaseApprovals] = await Promise.all([
      this.prisma.projectKnowledgeDoc.findMany({
        where: {
          projectId: validatedProjectId,
          ...(options.includeArchived ? {} : { status: "active" })
        },
        include: {
          versions: {
            where: {
              approvalStatus: "approved"
            },
            orderBy: {
              version: "desc"
            },
            take: 1
          }
        },
        orderBy: {
          updatedAt: "desc"
        }
      }),
      this.prisma.projectPhase.findMany({
        where: {
          projectId: validatedProjectId,
          ...(options.includeArchived ? {} : { status: { not: "archived" } })
        },
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }]
      }),
      this.prisma.projectKnowledgeVersion.count({
        where: {
          approvalStatus: "draft",
          doc: {
            projectId: validatedProjectId
          }
        }
      }),
      this.prisma.projectPhaseRevision.count({
        where: {
          approvalStatus: "draft",
          phase: {
            projectId: validatedProjectId
          }
        }
      })
    ]);

    const activeBriefDoc = docs.find((doc) => doc.type === "brief" && doc.activeVersion !== null);
    const activeArchitectureDoc = docs.find(
      (doc) => doc.type === "architecture_notes" && doc.activeVersion !== null
    );

    const briefVersion = activeBriefDoc?.versions[0];
    const architectureVersion = activeArchitectureDoc?.versions[0];

    const phaseSummary = phases.reduce(
      (acc, phase) => {
        acc.total += 1;
        if (phase.status === "planned") {
          acc.planned += 1;
        } else if (phase.status === "in_progress") {
          acc.inProgress += 1;
        } else if (phase.status === "blocked") {
          acc.blocked += 1;
        } else if (phase.status === "completed") {
          acc.completed += 1;
        } else {
          acc.archived += 1;
        }
        return acc;
      },
      {
        total: 0,
        planned: 0,
        inProgress: 0,
        blocked: 0,
        completed: 0,
        archived: 0
      }
    );

    return {
      project: {
        id: project.id,
        orgId: project.orgId,
        name: project.name,
        key: project.key,
        description: project.description,
        defaultBaseBranch: project.defaultBaseBranch,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString()
      },
      brief:
        briefVersion && activeBriefDoc
          ? {
              source: "knowledge_doc",
              docId: activeBriefDoc.id,
              title: activeBriefDoc.title,
              version: briefVersion.version,
              contentMarkdown: briefVersion.contentMarkdown
            }
          : project.description
            ? {
                source: "project_description_fallback",
                docId: null,
                title: "Project Brief",
                version: null,
                contentMarkdown: project.description
              }
            : null,
      architectureNotes:
        architectureVersion && activeArchitectureDoc
          ? {
              docId: activeArchitectureDoc.id,
              title: activeArchitectureDoc.title,
              version: architectureVersion.version,
              contentMarkdown: architectureVersion.contentMarkdown
            }
          : null,
      diagrams: {
        moduleCount: docs.filter((doc) => doc.type === "module_diagram").length,
        flowCount: docs.filter((doc) => doc.type === "flow_diagram").length
      },
      phaseSummary,
      pendingApprovals: {
        docs: pendingDocApprovals,
        phases: pendingPhaseApprovals
      }
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("knowledge/docs")
  async listDocs(@Param("projectId") projectId: string) {
    const { projectId: validatedProjectId } = projectPathSchema.parse({ projectId });
    await this.ensureProject(validatedProjectId);

    const docs = await this.prisma.projectKnowledgeDoc.findMany({
      where: {
        projectId: validatedProjectId
      },
      include: {
        versions: {
          orderBy: {
            version: "desc"
          },
          take: 50
        }
      },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }]
    });

    return docs.map((doc) => ({
      id: doc.id,
      orgId: doc.orgId,
      projectId: doc.projectId,
      type: doc.type,
      slug: doc.slug,
      title: doc.title,
      status: doc.status,
      activeVersion: doc.activeVersion,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      versions: doc.versions.map(mapKnowledgeVersion)
    }));
  }

  @Roles("owner", "admin", "member")
  @Post("knowledge/docs")
  async createDoc(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const { projectId: validatedProjectId } = projectPathSchema.parse({ projectId });
    const input = createDocSchema.parse(body);
    const project = await this.ensureProject(validatedProjectId);

    const slug = toSlug(input.slug ?? input.title);
    if (!slug) {
      throw new BadRequestException("Document slug resolved to empty value");
    }

    let normalizedMermaid: string | undefined;
    if (isDiagramDocType(input.type)) {
      if (!input.mermaidSource) {
        throw new BadRequestException("Diagram docs require a non-empty mermaidSource");
      }
      normalizedMermaid = normalizeMermaidSource(input.mermaidSource);
    } else {
      normalizedMermaid = normalizeMermaidIfPresent(input.mermaidSource);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.projectKnowledgeDoc.create({
        data: {
          orgId: project.orgId,
          projectId: project.id,
          type: input.type,
          slug,
          title: input.title,
          status: "active",
          createdBy: user.userId
        }
      });

      const version = await tx.projectKnowledgeVersion.create({
        data: {
          docId: doc.id,
          version: 1,
          contentMarkdown: input.contentMarkdown,
          mermaidSource: normalizedMermaid,
          changeSummary: input.changeSummary,
          approvalStatus: "draft",
          proposedBy: user.userId,
          proposedByType: input.proposedByType,
          sourceTaskId: input.sourceTaskId,
          sourceAiRunId: input.sourceAiRunId,
          baseVersion: doc.activeVersion
        }
      });

      return { doc, version };
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.knowledge.doc.created",
      entityType: "project_knowledge_doc",
      entityId: created.doc.id,
      payload: {
        type: created.doc.type,
        slug: created.doc.slug,
        title: created.doc.title
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.knowledge.version.proposed",
      entityType: "project_knowledge_version",
      entityId: created.version.id,
      payload: {
        docId: created.doc.id,
        version: created.version.version,
        proposedByType: created.version.proposedByType,
        sourceTaskId: created.version.sourceTaskId,
        sourceAiRunId: created.version.sourceAiRunId
      }
    });

    return {
      doc: {
        id: created.doc.id,
        orgId: created.doc.orgId,
        projectId: created.doc.projectId,
        type: created.doc.type,
        slug: created.doc.slug,
        title: created.doc.title,
        status: created.doc.status,
        activeVersion: created.doc.activeVersion,
        createdBy: created.doc.createdBy,
        createdAt: created.doc.createdAt.toISOString(),
        updatedAt: created.doc.updatedAt.toISOString()
      },
      version: mapKnowledgeVersion(created.version)
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("knowledge/docs/:docId/versions")
  async listDocVersions(
    @Param("projectId") projectId: string,
    @Param("docId") docId: string
  ) {
    const input = docPathSchema.parse({ projectId, docId });
    await this.ensureProject(input.projectId);

    const doc = await this.prisma.projectKnowledgeDoc.findFirst({
      where: {
        id: input.docId,
        projectId: input.projectId
      },
      select: {
        id: true,
        activeVersion: true,
        status: true
      }
    });

    if (!doc) {
      throw new NotFoundException("Knowledge doc not found");
    }

    const versions = await this.prisma.projectKnowledgeVersion.findMany({
      where: {
        docId: doc.id
      },
      orderBy: {
        version: "desc"
      }
    });

    return {
      docId: doc.id,
      activeVersion: doc.activeVersion,
      status: doc.status,
      versions: versions.map(mapKnowledgeVersion)
    };
  }

  @Roles("owner", "admin", "member")
  @Post("knowledge/docs/:docId/versions")
  async createDocVersion(
    @Param("projectId") projectId: string,
    @Param("docId") docId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const params = docPathSchema.parse({ projectId, docId });
    const input = createDocVersionSchema.parse(body);
    const project = await this.ensureProject(params.projectId);

    const doc = await this.prisma.projectKnowledgeDoc.findFirst({
      where: {
        id: params.docId,
        projectId: params.projectId
      }
    });

    if (!doc) {
      throw new NotFoundException("Knowledge doc not found");
    }

    const latestApprovedVersion = doc.activeVersion ?? 0;
    if (typeof input.baseVersion === "number" && input.baseVersion !== latestApprovedVersion) {
      return {
        created: false,
        reason: "version_conflict",
        docId: doc.id,
        latestApprovedVersion
      };
    }

    let normalizedMermaid: string | undefined;
    if (isDiagramDocType(doc.type)) {
      if (!input.mermaidSource) {
        throw new BadRequestException("Diagram docs require a non-empty mermaidSource");
      }
      normalizedMermaid = normalizeMermaidSource(input.mermaidSource);
    } else {
      normalizedMermaid = normalizeMermaidIfPresent(input.mermaidSource);
    }

    const latestVersion = await this.prisma.projectKnowledgeVersion.findFirst({
      where: {
        docId: doc.id
      },
      orderBy: {
        version: "desc"
      },
      select: {
        version: true
      }
    });

    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const created = await this.prisma.projectKnowledgeVersion.create({
      data: {
        docId: doc.id,
        version: nextVersion,
        contentMarkdown: input.contentMarkdown,
        mermaidSource: normalizedMermaid,
        changeSummary: input.changeSummary,
        approvalStatus: "draft",
        proposedBy: user.userId,
        proposedByType: input.proposedByType,
        sourceTaskId: input.sourceTaskId,
        sourceAiRunId: input.sourceAiRunId,
        baseVersion: input.baseVersion ?? doc.activeVersion
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.knowledge.version.proposed",
      entityType: "project_knowledge_version",
      entityId: created.id,
      payload: {
        docId: doc.id,
        version: created.version,
        proposedByType: created.proposedByType,
        sourceTaskId: created.sourceTaskId,
        sourceAiRunId: created.sourceAiRunId,
        baseVersion: created.baseVersion
      }
    });

    return {
      created: true,
      docId: doc.id,
      activeVersion: doc.activeVersion,
      version: mapKnowledgeVersion(created)
    };
  }

  @Roles("owner", "admin")
  @Post("knowledge/docs/:docId/versions/:version/approve")
  async approveDocVersion(
    @Param("projectId") projectId: string,
    @Param("docId") docId: string,
    @Param("version") version: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const params = docVersionPathSchema.parse({ projectId, docId, version });
    const input = approveOptionsSchema.parse(body ?? {});
    const project = await this.ensureProject(params.projectId);

    const doc = await this.prisma.projectKnowledgeDoc.findFirst({
      where: {
        id: params.docId,
        projectId: params.projectId
      }
    });

    if (!doc) {
      throw new NotFoundException("Knowledge doc not found");
    }

    const targetVersion = await this.prisma.projectKnowledgeVersion.findFirst({
      where: {
        docId: doc.id,
        version: params.version
      }
    });

    if (!targetVersion) {
      throw new NotFoundException("Knowledge doc version not found");
    }

    if (targetVersion.approvalStatus !== "draft") {
      return {
        approved: false,
        reason: "version_not_pending",
        docId: doc.id,
        version: targetVersion.version,
        status: targetVersion.approvalStatus
      };
    }

    const latestApprovedVersion = doc.activeVersion ?? 0;
    if (
      (typeof input.expectedBaseVersion === "number" && input.expectedBaseVersion !== latestApprovedVersion) ||
      (typeof targetVersion.baseVersion === "number" && targetVersion.baseVersion !== latestApprovedVersion)
    ) {
      return {
        approved: false,
        reason: "version_conflict",
        docId: doc.id,
        version: targetVersion.version,
        latestApprovedVersion
      };
    }

    const approvedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.projectKnowledgeVersion.updateMany({
        where: {
          docId: doc.id,
          approvalStatus: "approved",
          id: {
            not: targetVersion.id
          }
        },
        data: {
          approvalStatus: "superseded"
        }
      });

      await tx.projectKnowledgeVersion.update({
        where: {
          id: targetVersion.id
        },
        data: {
          approvalStatus: "approved",
          approvedBy: user.userId,
          approvedAt
        }
      });

      await tx.projectKnowledgeDoc.update({
        where: {
          id: doc.id
        },
        data: {
          activeVersion: targetVersion.version,
          status: "active"
        }
      });
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.knowledge.version.approved",
      entityType: "project_knowledge_version",
      entityId: targetVersion.id,
      payload: {
        docId: doc.id,
        version: targetVersion.version,
        previousActiveVersion: doc.activeVersion
      }
    });

    return {
      approved: true,
      docId: doc.id,
      version: targetVersion.version,
      activeVersion: targetVersion.version,
      approvedAt: approvedAt.toISOString()
    };
  }

  @Roles("owner", "admin")
  @Post("knowledge/docs/:docId/versions/:version/reject")
  async rejectDocVersion(
    @Param("projectId") projectId: string,
    @Param("docId") docId: string,
    @Param("version") version: string,
    @CurrentUser() user: AuthContext
  ) {
    const params = docVersionPathSchema.parse({ projectId, docId, version });
    const project = await this.ensureProject(params.projectId);

    const doc = await this.prisma.projectKnowledgeDoc.findFirst({
      where: {
        id: params.docId,
        projectId: params.projectId
      }
    });

    if (!doc) {
      throw new NotFoundException("Knowledge doc not found");
    }

    const targetVersion = await this.prisma.projectKnowledgeVersion.findFirst({
      where: {
        docId: doc.id,
        version: params.version
      }
    });

    if (!targetVersion) {
      throw new NotFoundException("Knowledge doc version not found");
    }

    if (targetVersion.approvalStatus !== "draft") {
      return {
        rejected: false,
        reason: "version_not_pending",
        docId: doc.id,
        version: targetVersion.version,
        status: targetVersion.approvalStatus
      };
    }

    const rejectedAt = new Date();
    const rejected = await this.prisma.projectKnowledgeVersion.update({
      where: {
        id: targetVersion.id
      },
      data: {
        approvalStatus: "rejected",
        approvedBy: user.userId,
        approvedAt: rejectedAt
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.knowledge.version.rejected",
      entityType: "project_knowledge_version",
      entityId: rejected.id,
      payload: {
        docId: doc.id,
        version: rejected.version
      }
    });

    return {
      rejected: true,
      docId: doc.id,
      version: rejected.version,
      rejectedAt: rejectedAt.toISOString()
    };
  }

  @Roles("owner", "admin")
  @Post("knowledge/docs/:docId/archive")
  async archiveDoc(
    @Param("projectId") projectId: string,
    @Param("docId") docId: string,
    @CurrentUser() user: AuthContext
  ) {
    const params = docPathSchema.parse({ projectId, docId });
    const project = await this.ensureProject(params.projectId);

    const doc = await this.prisma.projectKnowledgeDoc.findFirst({
      where: {
        id: params.docId,
        projectId: params.projectId
      }
    });

    if (!doc) {
      throw new NotFoundException("Knowledge doc not found");
    }

    const archived = await this.prisma.projectKnowledgeDoc.update({
      where: {
        id: doc.id
      },
      data: {
        status: "archived"
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.knowledge.doc.archived",
      entityType: "project_knowledge_doc",
      entityId: archived.id,
      payload: {
        slug: archived.slug,
        title: archived.title
      }
    });

    return {
      archived: true,
      docId: archived.id,
      status: archived.status
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("phases")
  async listPhases(@Param("projectId") projectId: string) {
    const { projectId: validatedProjectId } = projectPathSchema.parse({ projectId });
    await this.ensureProject(validatedProjectId);

    const phases = await this.prisma.projectPhase.findMany({
      where: {
        projectId: validatedProjectId
      },
      include: {
        revisions: {
          orderBy: {
            revision: "desc"
          },
          take: 50
        }
      },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }]
    });

    return phases.map((phase) => ({
      id: phase.id,
      orgId: phase.orgId,
      projectId: phase.projectId,
      key: phase.key,
      name: phase.name,
      objective: phase.objective,
      status: phase.status,
      ownerUserId: phase.ownerUserId,
      orderIndex: phase.orderIndex,
      plannedStartAt: phase.plannedStartAt?.toISOString() ?? null,
      plannedEndAt: phase.plannedEndAt?.toISOString() ?? null,
      completedAt: phase.completedAt?.toISOString() ?? null,
      createdAt: phase.createdAt.toISOString(),
      updatedAt: phase.updatedAt.toISOString(),
      revisions: phase.revisions.map(mapPhaseRevision)
    }));
  }

  @Roles("owner", "admin", "member")
  @Post("phases")
  async createPhase(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const { projectId: validatedProjectId } = projectPathSchema.parse({ projectId });
    const input = createPhaseSchema.parse(body);
    const project = await this.ensureProject(validatedProjectId);

    const created = await this.prisma.$transaction(async (tx) => {
      const maxOrder = await tx.projectPhase.findFirst({
        where: {
          projectId: project.id
        },
        orderBy: {
          orderIndex: "desc"
        },
        select: {
          orderIndex: true
        }
      });

      const orderIndex = input.orderIndex ?? (maxOrder ? maxOrder.orderIndex + 1 : 0);

      const phase = await tx.projectPhase.create({
        data: {
          orgId: project.orgId,
          projectId: project.id,
          key: input.key,
          name: input.name,
          objective: input.objective ?? null,
          status: input.status,
          ownerUserId: input.ownerUserId ?? null,
          orderIndex,
          plannedStartAt: parseDateValue(input.plannedStartAt),
          plannedEndAt: parseDateValue(input.plannedEndAt),
          completedAt: parseDateValue(input.completedAt)
        }
      });

      const payload = {
        name: phase.name,
        objective: phase.objective,
        status: phase.status,
        ownerUserId: phase.ownerUserId,
        orderIndex: phase.orderIndex,
        plannedStartAt: phase.plannedStartAt?.toISOString() ?? null,
        plannedEndAt: phase.plannedEndAt?.toISOString() ?? null,
        completedAt: phase.completedAt?.toISOString() ?? null
      };

      const revision = await tx.projectPhaseRevision.create({
        data: {
          phaseId: phase.id,
          revision: 1,
          payload: toJson(payload),
          approvalStatus: "draft",
          proposedBy: user.userId,
          proposedByType: input.proposedByType,
          sourceTaskId: input.sourceTaskId,
          sourceAiRunId: input.sourceAiRunId,
          baseRevision: 0
        }
      });

      return {
        phase,
        revision
      };
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.phase.created",
      entityType: "project_phase",
      entityId: created.phase.id,
      payload: {
        key: created.phase.key,
        name: created.phase.name,
        status: created.phase.status,
        orderIndex: created.phase.orderIndex
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.phase.revision.proposed",
      entityType: "project_phase_revision",
      entityId: created.revision.id,
      payload: {
        phaseId: created.phase.id,
        revision: created.revision.revision,
        proposedByType: created.revision.proposedByType,
        baseRevision: created.revision.baseRevision
      }
    });

    return {
      phase: {
        id: created.phase.id,
        orgId: created.phase.orgId,
        projectId: created.phase.projectId,
        key: created.phase.key,
        name: created.phase.name,
        objective: created.phase.objective,
        status: created.phase.status,
        ownerUserId: created.phase.ownerUserId,
        orderIndex: created.phase.orderIndex,
        plannedStartAt: created.phase.plannedStartAt?.toISOString() ?? null,
        plannedEndAt: created.phase.plannedEndAt?.toISOString() ?? null,
        completedAt: created.phase.completedAt?.toISOString() ?? null,
        createdAt: created.phase.createdAt.toISOString(),
        updatedAt: created.phase.updatedAt.toISOString()
      },
      revision: mapPhaseRevision(created.revision)
    };
  }

  @Roles("owner", "admin", "member")
  @Post("phases/:phaseId/revisions")
  async createPhaseRevision(
    @Param("projectId") projectId: string,
    @Param("phaseId") phaseId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const params = phasePathSchema.parse({ projectId, phaseId });
    const input = createPhaseRevisionSchema.parse(body);
    const project = await this.ensureProject(params.projectId);

    const phase = await this.prisma.projectPhase.findFirst({
      where: {
        id: params.phaseId,
        projectId: params.projectId
      }
    });

    if (!phase) {
      throw new NotFoundException("Project phase not found");
    }

    const latestApprovedRevision = await this.prisma.projectPhaseRevision.findFirst({
      where: {
        phaseId: phase.id,
        approvalStatus: "approved"
      },
      orderBy: {
        revision: "desc"
      },
      select: {
        revision: true
      }
    });

    const latestApprovedRevisionNumber = latestApprovedRevision?.revision ?? 0;
    if (
      typeof input.baseRevision === "number" &&
      input.baseRevision !== latestApprovedRevisionNumber
    ) {
      return {
        created: false,
        reason: "revision_conflict",
        phaseId: phase.id,
        latestApprovedRevision: latestApprovedRevisionNumber
      };
    }

    const latestRevision = await this.prisma.projectPhaseRevision.findFirst({
      where: {
        phaseId: phase.id
      },
      orderBy: {
        revision: "desc"
      },
      select: {
        revision: true
      }
    });

    const nextRevision = (latestRevision?.revision ?? 0) + 1;

    const snapshot = {
      name: input.name ?? phase.name,
      objective: input.objective === undefined ? phase.objective : input.objective,
      status: input.status ?? phase.status,
      ownerUserId: input.ownerUserId === undefined ? phase.ownerUserId : input.ownerUserId,
      orderIndex: input.orderIndex ?? phase.orderIndex,
      plannedStartAt:
        input.plannedStartAt === undefined
          ? phase.plannedStartAt?.toISOString() ?? null
          : input.plannedStartAt,
      plannedEndAt:
        input.plannedEndAt === undefined
          ? phase.plannedEndAt?.toISOString() ?? null
          : input.plannedEndAt,
      completedAt:
        input.completedAt === undefined
          ? phase.completedAt?.toISOString() ?? null
          : input.completedAt
    };

    const normalizedPayload = phasePayloadSchema.parse(snapshot);

    const created = await this.prisma.projectPhaseRevision.create({
      data: {
        phaseId: phase.id,
        revision: nextRevision,
        payload: toJson(normalizedPayload),
        approvalStatus: "draft",
        proposedBy: user.userId,
        proposedByType: input.proposedByType,
        sourceTaskId: input.sourceTaskId,
        sourceAiRunId: input.sourceAiRunId,
        baseRevision: input.baseRevision ?? latestApprovedRevisionNumber
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.phase.revision.proposed",
      entityType: "project_phase_revision",
      entityId: created.id,
      payload: {
        phaseId: phase.id,
        revision: created.revision,
        baseRevision: created.baseRevision,
        proposedByType: created.proposedByType,
        changeSummary: input.changeSummary
      }
    });

    return {
      created: true,
      phaseId: phase.id,
      latestApprovedRevision: latestApprovedRevisionNumber,
      revision: mapPhaseRevision(created)
    };
  }

  @Roles("owner", "admin")
  @Post("phases/:phaseId/revisions/:revision/approve")
  async approvePhaseRevision(
    @Param("projectId") projectId: string,
    @Param("phaseId") phaseId: string,
    @Param("revision") revision: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const params = phaseRevisionPathSchema.parse({ projectId, phaseId, revision });
    const input = approveOptionsSchema.parse(body ?? {});
    const project = await this.ensureProject(params.projectId);

    const phase = await this.prisma.projectPhase.findFirst({
      where: {
        id: params.phaseId,
        projectId: params.projectId
      }
    });

    if (!phase) {
      throw new NotFoundException("Project phase not found");
    }

    const targetRevision = await this.prisma.projectPhaseRevision.findFirst({
      where: {
        phaseId: phase.id,
        revision: params.revision
      }
    });

    if (!targetRevision) {
      throw new NotFoundException("Project phase revision not found");
    }

    if (targetRevision.approvalStatus !== "draft") {
      return {
        approved: false,
        reason: "revision_not_pending",
        phaseId: phase.id,
        revision: targetRevision.revision,
        status: targetRevision.approvalStatus
      };
    }

    const latestApprovedRevision = await this.prisma.projectPhaseRevision.findFirst({
      where: {
        phaseId: phase.id,
        approvalStatus: "approved"
      },
      orderBy: {
        revision: "desc"
      },
      select: {
        revision: true
      }
    });

    const latestApprovedRevisionNumber = latestApprovedRevision?.revision ?? 0;
    if (
      (typeof input.expectedBaseRevision === "number" &&
        input.expectedBaseRevision !== latestApprovedRevisionNumber) ||
      (typeof targetRevision.baseRevision === "number" &&
        targetRevision.baseRevision !== latestApprovedRevisionNumber)
    ) {
      return {
        approved: false,
        reason: "revision_conflict",
        phaseId: phase.id,
        revision: targetRevision.revision,
        latestApprovedRevision: latestApprovedRevisionNumber
      };
    }

    const payload = phasePayloadSchema.parse(targetRevision.payload);
    const approvedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.projectPhaseRevision.updateMany({
        where: {
          phaseId: phase.id,
          approvalStatus: "approved",
          id: {
            not: targetRevision.id
          }
        },
        data: {
          approvalStatus: "superseded"
        }
      });

      await tx.projectPhaseRevision.update({
        where: {
          id: targetRevision.id
        },
        data: {
          approvalStatus: "approved",
          approvedBy: user.userId,
          approvedAt
        }
      });

      await tx.projectPhase.update({
        where: {
          id: phase.id
        },
        data: {
          name: payload.name,
          objective: payload.objective,
          status: payload.status,
          ownerUserId: payload.ownerUserId,
          orderIndex: payload.orderIndex,
          plannedStartAt: parseDateValue(payload.plannedStartAt),
          plannedEndAt: parseDateValue(payload.plannedEndAt),
          completedAt: parseDateValue(payload.completedAt)
        }
      });
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.phase.revision.approved",
      entityType: "project_phase_revision",
      entityId: targetRevision.id,
      payload: {
        phaseId: phase.id,
        revision: targetRevision.revision,
        previousApprovedRevision: latestApprovedRevisionNumber
      }
    });

    return {
      approved: true,
      phaseId: phase.id,
      revision: targetRevision.revision,
      approvedAt: approvedAt.toISOString()
    };
  }

  @Roles("owner", "admin")
  @Post("phases/reorder")
  async reorderPhases(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const { projectId: validatedProjectId } = projectPathSchema.parse({ projectId });
    const input = reorderPhasesSchema.parse(body);
    const project = await this.ensureProject(validatedProjectId);

    const phases = await this.prisma.projectPhase.findMany({
      where: {
        projectId: project.id,
        id: {
          in: input.phaseIds
        }
      },
      select: {
        id: true
      }
    });

    if (phases.length !== input.phaseIds.length) {
      throw new NotFoundException("One or more phases were not found in this project");
    }

    await this.prisma.$transaction(
      input.phaseIds.map((phaseId, index) =>
        this.prisma.projectPhase.update({
          where: {
            id: phaseId
          },
          data: {
            orderIndex: index
          }
        })
      )
    );

    await appendAuditLog({
      prisma: this.prisma,
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "project.phase.reordered",
      entityType: "project",
      entityId: project.id,
      payload: {
        phaseIds: input.phaseIds
      }
    });

    return {
      reordered: true,
      projectId: project.id,
      phaseIds: input.phaseIds
    };
  }

  private async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: {
        id: projectId
      },
      select: {
        id: true,
        orgId: true,
        name: true,
        key: true,
        description: true,
        defaultBaseBranch: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return project;
  }
}
