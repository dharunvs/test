import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";

import { PrismaService } from "../../common/prisma.service.js";
import { Roles } from "../auth/roles.decorator.js";

const bindRepositorySchema = z.object({
  projectId: z.string().uuid(),
  provider: z.enum(["github", "gitlab"]),
  providerRepoId: z.string().optional(),
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string().default("main"),
  isPrivate: z.boolean().default(true)
});

const listQuerySchema = z.object({
  projectId: z.string().uuid().optional()
});

@Controller("repositories")
export class RepositoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const input = listQuerySchema.parse(query);

    if (!input.projectId) {
      return [];
    }

    const repositories = await this.prisma.repository.findMany({
      where: {
        projects: {
          some: {
            projectId: input.projectId
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return repositories.map((repository) => ({
      id: repository.id,
      provider: repository.provider,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      isPrivate: repository.isPrivate
    }));
  }

  @Roles("owner", "admin", "member")
  @Post("bind")
  async bind(@Body() body: unknown) {
    const input = bindRepositorySchema.parse(body);

    const project = await this.prisma.project.findUnique({
      where: {
        id: input.projectId
      }
    });

    if (!project) {
      return {
        error: "project_not_found"
      };
    }

    const providerRepoId = input.providerRepoId ?? `${input.owner}/${input.name}`;

    const repository = await this.prisma.repository.upsert({
      where: {
        provider_providerRepoId: {
          provider: input.provider,
          providerRepoId
        }
      },
      update: {
        owner: input.owner,
        name: input.name,
        fullName: `${input.owner}/${input.name}`,
        defaultBranch: input.defaultBranch,
        isPrivate: input.isPrivate
      },
      create: {
        orgId: project.orgId,
        provider: input.provider,
        providerRepoId,
        owner: input.owner,
        name: input.name,
        fullName: `${input.owner}/${input.name}`,
        defaultBranch: input.defaultBranch,
        isPrivate: input.isPrivate,
        metadata: {}
      }
    });

    await this.prisma.projectRepository.upsert({
      where: {
        projectId_repositoryId: {
          projectId: input.projectId,
          repositoryId: repository.id
        }
      },
      update: {},
      create: {
        projectId: input.projectId,
        repositoryId: repository.id,
        isPrimary: false
      }
    });

    return {
      id: repository.id,
      fullName: repository.fullName,
      projectId: input.projectId,
      createdAt: repository.createdAt
    };
  }
}
