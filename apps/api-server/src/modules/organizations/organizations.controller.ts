import { Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";

import { appendAuditLog } from "../../common/audit.js";
import { PrismaService } from "../../common/prisma.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const createOrganizationSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2)
});

@Controller("orgs")
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId: user.userId
      },
      include: {
        organization: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role
    }));
  }

  @Roles("owner", "admin", "member")
  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = createOrganizationSchema.parse(body);

    const organization = await this.prisma.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        ownerUserId: user.userId,
        settings: {}
      }
    });

    await this.prisma.organizationMember.upsert({
      where: {
        orgId_userId: {
          orgId: organization.id,
          userId: user.userId
        }
      },
      update: {
        role: "owner",
        status: "active",
        joinedAt: new Date()
      },
      create: {
        orgId: organization.id,
        userId: user.userId,
        role: "owner",
        status: "active",
        joinedAt: new Date()
      }
    });

    await appendAuditLog({
      prisma: this.prisma,
      orgId: organization.id,
      actorUserId: user.userId,
      actorType: "user",
      eventType: "organization.created",
      entityType: "organization",
      entityId: organization.id,
      payload: {
        name: organization.name,
        slug: organization.slug
      }
    });

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt
    };
  }
}
