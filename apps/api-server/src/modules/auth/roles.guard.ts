import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { PrismaService } from "../../common/prisma.service.js";
import type { AuthContext, BranchlineRole } from "./auth.types.js";
import { ROLES_KEY } from "./roles.decorator.js";

type RequestShape = {
  auth?: AuthContext;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  url?: string;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectRoleToBranchlineRole(role: string | undefined): BranchlineRole | undefined {
  if (role === "admin") {
    return "admin";
  }
  if (role === "member") {
    return "member";
  }
  if (role === "viewer") {
    return "viewer";
  }
  return undefined;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestShape>();
    const role = request.auth?.role;

    if (!role || !allowedRoles.includes(role)) {
      throw new ForbiddenException("Insufficient role for this action");
    }

    const userId = request.auth?.userId;
    if (!userId) {
      throw new ForbiddenException("Authenticated user context is missing");
    }

    const scope = await this.resolveScope(request);

    if (scope.orgId) {
      const orgMembership = await this.prisma.organizationMember.findFirst({
        where: {
          orgId: scope.orgId,
          userId,
          status: "active"
        }
      });

      if (!orgMembership) {
        throw new ForbiddenException("User is not an active member of this organization");
      }

      if (scope.projectId) {
        const projectMembership = await this.prisma.projectMember.findFirst({
          where: {
            projectId: scope.projectId,
            userId,
            status: "active"
          }
        });

        const scopedRole =
          normalizeOrgRole(orgMembership.role) ??
          projectRoleToBranchlineRole(projectMembership?.role ?? undefined) ??
          role;

        if (!allowedRoles.includes(scopedRole)) {
          throw new ForbiddenException("Insufficient project role for this action");
        }
      }
    }

    return true;
  }

  private async resolveScope(request: RequestShape): Promise<{ orgId?: string; projectId?: string }> {
    let orgId =
      readString(request.body?.orgId) ?? readString(request.params?.orgId) ?? readString(request.query?.orgId);
    let projectId =
      readString(request.body?.projectId) ??
      readString(request.params?.projectId) ??
      readString(request.query?.projectId);

    const routePath = request.url?.split("?")[0] ?? "";

    const taskId =
      readString(request.body?.taskId) ??
      readString(request.query?.taskId) ??
      readString(request.params?.taskId) ??
      (routePath.startsWith("/v1/tasks/") ? readString(request.params?.id) : undefined) ??
      (routePath.startsWith("/v1/replay/") ? readString(request.params?.taskId) : undefined);

    const branchId =
      readString(request.body?.branchId) ??
      readString(request.params?.branchId) ??
      (routePath.startsWith("/v1/branches/") ? readString(request.params?.id) : undefined);
    const repositoryId =
      readString(request.body?.repositoryId) ??
      readString(request.query?.repositoryId) ??
      readString(request.params?.repositoryId);

    const handoffId =
      readString(request.body?.handoffId) ??
      readString(request.params?.handoffPacketId) ??
      (routePath.startsWith("/v1/handoffs/") ? readString(request.params?.id) : undefined);

    const qualityRunId =
      readString(request.body?.qualityRunId) ??
      (routePath.startsWith("/v1/quality-gates/") ? readString(request.params?.id) : undefined);
    const orgMembershipId =
      (routePath.startsWith("/v1/memberships/") && routePath.endsWith("/role")
        ? readString(request.params?.id)
        : undefined) ??
      (routePath === "/v1/memberships/revoke" ? readString(request.body?.inviteId) : undefined);
    const projectMemberId =
      routePath.startsWith("/v1/memberships/project-members/") ? readString(request.params?.id) : undefined;
    const integrationConnectionId =
      readString(request.body?.connectionId) ??
      readString(request.query?.connectionId) ??
      (routePath.startsWith("/v1/integrations/connections/") ? readString(request.params?.id) : undefined);

    if (!projectId && taskId) {
      const task = await this.prisma.task.findUnique({
        where: {
          id: taskId
        },
        select: {
          orgId: true,
          projectId: true
        }
      });

      if (task) {
        orgId = orgId ?? task.orgId;
        projectId = projectId ?? task.projectId;
      }
    }

    if (!projectId && branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: {
          id: branchId
        },
        select: {
          orgId: true,
          projectId: true
        }
      });

      if (branch) {
        orgId = orgId ?? branch.orgId;
        projectId = projectId ?? branch.projectId;
      }
    }

    if (!projectId && handoffId) {
      const handoff = await this.prisma.handoffPacket.findUnique({
        where: {
          id: handoffId
        },
        select: {
          orgId: true,
          projectId: true
        }
      });

      if (handoff) {
        orgId = orgId ?? handoff.orgId;
        projectId = projectId ?? handoff.projectId;
      }
    }

    if (!projectId && qualityRunId) {
      const run = await this.prisma.qualityGateRun.findUnique({
        where: {
          id: qualityRunId
        },
        select: {
          orgId: true,
          projectId: true
        }
      });

      if (run) {
        orgId = orgId ?? run.orgId;
        projectId = projectId ?? run.projectId;
      }
    }

    if (!projectId && orgMembershipId) {
      const membership = await this.prisma.organizationMember.findUnique({
        where: {
          id: orgMembershipId
        },
        select: {
          orgId: true
        }
      });

      if (membership) {
        orgId = orgId ?? membership.orgId;
      }
    }

    if (!projectId && projectMemberId) {
      const member = await this.prisma.projectMember.findUnique({
        where: {
          id: projectMemberId
        },
        select: {
          projectId: true
        }
      });

      if (member) {
        projectId = member.projectId;
      }
    }

    if (!orgId && repositoryId) {
      const repository = await this.prisma.repository.findUnique({
        where: {
          id: repositoryId
        },
        select: {
          orgId: true
        }
      });

      if (repository) {
        orgId = repository.orgId;
      }
    }

    if (!orgId && integrationConnectionId) {
      const connection = await this.prisma.integrationConnection.findUnique({
        where: {
          id: integrationConnectionId
        },
        select: {
          orgId: true,
          projectId: true
        }
      });

      if (connection) {
        orgId = connection.orgId;
        projectId = projectId ?? connection.projectId ?? undefined;
      }
    }

    if (projectId && !orgId) {
      const project = await this.prisma.project.findUnique({
        where: {
          id: projectId
        },
        select: {
          orgId: true
        }
      });

      orgId = project?.orgId;
    }

    return {
      orgId,
      projectId
    };
  }
}

function normalizeOrgRole(role: string | undefined): BranchlineRole | undefined {
  if (role === "owner" || role === "admin" || role === "member" || role === "viewer") {
    return role;
  }
  return undefined;
}
