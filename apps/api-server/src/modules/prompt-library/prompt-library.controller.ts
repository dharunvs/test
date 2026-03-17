import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const templateSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(2),
  slug: z.string().min(2).optional(),
  category: z.string().min(2),
  content: z.string().min(5),
  variables: z.record(z.unknown()).default({})
});

const templateVersionSchema = z.object({
  content: z.string().min(5),
  variables: z.record(z.unknown()).default({}),
  changelog: z.string().optional()
});

const listSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional()
});

const usageRecordSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  templateId: z.string().uuid(),
  templateVersionId: z.string().uuid().optional(),
  aiRunId: z.string().uuid().optional(),
  successRating: z.number().int().min(1).max(5).optional()
});

const usageQuerySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  sinceDays: z.coerce.number().int().positive().max(365).default(30)
});

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

@Controller("prompt-library")
export class PromptLibraryController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get("templates")
  async list(@Query() query: Record<string, unknown>) {
    const input = listSchema.parse(query);

    return this.prisma.promptTemplate.findMany({
      where: {
        orgId: input.orgId,
        projectId: input.projectId
      },
      include: {
        versions: {
          orderBy: {
            version: "desc"
          },
          take: 1
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  @Roles("owner", "admin", "member")
  @Post("templates")
  async create(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = templateSchema.parse(body);

    const template = await this.prisma.promptTemplate.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        name: input.name,
        slug: input.slug ? toSlug(input.slug) : toSlug(input.name),
        category: input.category,
        createdBy: user.userId,
        isActive: true
      }
    });

    const version = await this.prisma.promptTemplateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        content: input.content,
        variables: toJson(input.variables),
        createdBy: user.userId,
        changelog: "Initial version"
      }
    });

    return {
      id: template.id,
      name: template.name,
      slug: template.slug,
      category: template.category,
      version: version.version,
      createdAt: template.createdAt
    };
  }

  @Roles("owner", "admin", "member")
  @Post("templates/:id/versions")
  async createVersion(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthContext
  ) {
    const input = templateVersionSchema.parse(body);

    const template = await this.prisma.promptTemplate.findUnique({
      where: {
        id
      }
    });

    if (!template) {
      return {
        created: false,
        reason: "template_not_found"
      };
    }

    const latestVersion = await this.prisma.promptTemplateVersion.findFirst({
      where: {
        templateId: template.id
      },
      orderBy: {
        version: "desc"
      },
      select: {
        version: true
      }
    });

    const nextVersion = (latestVersion?.version ?? 0) + 1;
    const created = await this.prisma.promptTemplateVersion.create({
      data: {
        templateId: template.id,
        version: nextVersion,
        content: input.content,
        variables: toJson(input.variables),
        changelog: input.changelog,
        createdBy: user.userId
      }
    });

    return {
      created: true,
      templateId: template.id,
      versionId: created.id,
      version: created.version
    };
  }

  @Roles("owner", "admin", "member")
  @Post("usage")
  async trackUsage(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = usageRecordSchema.parse(body);

    const template = await this.prisma.promptTemplate.findUnique({
      where: {
        id: input.templateId
      },
      select: {
        id: true,
        orgId: true,
        projectId: true
      }
    });

    if (!template || template.orgId !== input.orgId) {
      return {
        tracked: false,
        reason: "template_not_found"
      };
    }

    const usage = await this.prisma.promptUsage.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        taskId: input.taskId,
        templateId: input.templateId,
        templateVersionId: input.templateVersionId,
        aiRunId: input.aiRunId,
        successRating: input.successRating,
        usedBy: user.userId
      }
    });

    return {
      tracked: true,
      usageId: usage.id,
      createdAt: usage.createdAt
    };
  }

  @Roles("owner", "admin", "member", "viewer")
  @Get("usage")
  async usageAnalytics(@Query() query: Record<string, unknown>) {
    const input = usageQuerySchema.parse(query);
    const since = new Date(Date.now() - input.sinceDays * 24 * 60 * 60 * 1000);

    const usages = await this.prisma.promptUsage.findMany({
      where: {
        orgId: input.orgId,
        projectId: input.projectId,
        templateId: input.templateId,
        createdAt: {
          gte: since
        }
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        templateVersion: {
          select: {
            id: true,
            version: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 5000
    });

    const byTemplate = new Map<
      string,
      {
        templateId: string;
        name: string;
        slug: string;
        usageCount: number;
        ratings: number[];
        versions: Record<string, number>;
      }
    >();

    for (const usage of usages) {
      if (!usage.template) {
        continue;
      }

      const existing = byTemplate.get(usage.template.id) ?? {
        templateId: usage.template.id,
        name: usage.template.name,
        slug: usage.template.slug,
        usageCount: 0,
        ratings: [],
        versions: {}
      };

      existing.usageCount += 1;
      if (typeof usage.successRating === "number") {
        existing.ratings.push(usage.successRating);
      }
      if (usage.templateVersion) {
        const key = `v${usage.templateVersion.version}`;
        existing.versions[key] = (existing.versions[key] ?? 0) + 1;
      }

      byTemplate.set(usage.template.id, existing);
    }

    return {
      orgId: input.orgId,
      projectId: input.projectId,
      sinceDays: input.sinceDays,
      totalUsage: usages.length,
      templates: [...byTemplate.values()]
        .map((entry) => ({
          templateId: entry.templateId,
          name: entry.name,
          slug: entry.slug,
          usageCount: entry.usageCount,
          averageRating:
            entry.ratings.length > 0
              ? Number(
                  (entry.ratings.reduce((sum, rating) => sum + rating, 0) / entry.ratings.length).toFixed(2)
                )
              : null,
          versions: entry.versions
        }))
        .sort((left, right) => right.usageCount - left.usageCount)
    };
  }
}
