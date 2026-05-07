import { createHash, createSecretKey, randomUUID } from "node:crypto";

import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";

import { readEnv } from "../../common/env.js";
import { PrismaService } from "../../common/prisma.service.js";
import type { AuthContext, BranchlineRole } from "./auth.types.js";

function normalizeRole(value: unknown): BranchlineRole {
  if (value === "owner" || value === "admin" || value === "member" || value === "viewer") {
    return value;
  }
  return "member";
}

function roleWeight(role: BranchlineRole): number {
  switch (role) {
    case "owner":
      return 4;
    case "admin":
      return 3;
    case "member":
      return 2;
    case "viewer":
      return 1;
    default:
      return 0;
  }
}

interface GithubProfile {
  id: number;
  login?: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

interface GithubEmailEntry {
  email?: string;
  primary?: boolean;
  verified?: boolean;
}

@Injectable()
export class AuthService {
  private readonly env = readEnv();
  private readonly devIssuer = "branchline-dev";

  constructor(private readonly prisma: PrismaService) {}

  async startDeviceFlow(input?: { email?: string; role?: BranchlineRole }) {
    const email = (input?.email ?? "demo@branchline.dev").toLowerCase().trim();
    const role = normalizeRole(input?.role);
    const clerkUserId = `dev_${email.replace(/[^a-z0-9]/g, "_")}`;
    const verificationRequired = this.env.nodeEnv === "production";

    const deviceCode = randomUUID();
    const userCode = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + this.env.authDeviceCodeTtlSeconds * 1000);
    const verificationUri = `${this.env.webConsoleBaseUrl}/device`;
    const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

    await this.prisma.deviceAuthSession.create({
      data: {
        deviceCode,
        userCode,
        email,
        role,
        clerkUserId,
        status: verificationRequired ? "pending" : "approved",
        approvedAt: verificationRequired ? null : new Date(),
        expiresAt
      }
    });

    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      verificationRequired,
      expiresIn: this.env.authDeviceCodeTtlSeconds,
      interval: 2
    };
  }

  async approveDeviceCode(userCode: string) {
    const session = await this.prisma.deviceAuthSession.findFirst({
      where: {
        userCode,
        status: {
          in: ["pending", "approved"]
        }
      }
    });

    if (!session) {
      throw new UnauthorizedException("Unknown user code");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.deviceAuthSession.update({
        where: {
          id: session.id
        },
        data: {
          status: "expired"
        }
      });
      throw new UnauthorizedException("Device code expired");
    }

    await this.prisma.deviceAuthSession.update({
      where: {
        id: session.id
      },
      data: {
        status: "approved",
        approvedAt: new Date()
      }
    });

    return { approved: true };
  }

  async exchangeDeviceCode(
    deviceCode: string,
    metadata?: {
      userAgent?: string;
      ipAddress?: string;
    }
  ) {
    const session = await this.prisma.deviceAuthSession.findUnique({
      where: {
        deviceCode
      }
    });

    if (!session) {
      throw new UnauthorizedException("Unknown device code");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.deviceAuthSession.update({
        where: {
          id: session.id
        },
        data: {
          status: "expired"
        }
      });
      throw new UnauthorizedException("Device code expired");
    }

    if (session.status !== "approved" || !session.approvedAt) {
      return {
        status: "authorization_pending"
      } as const;
    }

    const user = await this.upsertUserWithIdentity({
      clerkUserId: session.clerkUserId,
      email: session.email,
      displayName: session.email.split("@")[0] ?? "Branchline User"
    });

    const effectiveRole = await this.resolveEffectiveRole(user.id, normalizeRole(session.role));
    const accessToken = await this.signAccessToken({
      sub: user.clerkUserId,
      email: user.email,
      role: effectiveRole
    });

    const { rawToken: refreshToken, expiresAt } = await this.createRefreshToken(user.id, metadata);

    await this.prisma.deviceAuthSession.update({
      where: {
        id: session.id
      },
      data: {
        userId: user.id,
        status: "exchanged",
        exchangedAt: new Date()
      }
    });

    return {
      status: "approved",
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.env.authAccessTokenTtlSeconds,
      refreshExpiresAt: expiresAt.toISOString()
    } as const;
  }

  async refreshAccessToken(
    rawRefreshToken: string,
    metadata?: {
      userAgent?: string;
      ipAddress?: string;
    }
  ) {
    const refreshToken = await this.findValidRefreshToken(rawRefreshToken);

    const user = await this.prisma.user.findUnique({
      where: {
        id: refreshToken.userId
      }
    });

    if (!user) {
      throw new UnauthorizedException("Refresh token user no longer exists");
    }

    const effectiveRole = await this.resolveEffectiveRole(user.id, "member");

    const accessToken = await this.signAccessToken({
      sub: user.clerkUserId,
      email: user.email,
      role: effectiveRole
    });

    const { rawToken: nextRefreshToken, expiresAt: nextRefreshExpiresAt, id: nextTokenId } =
      await this.createRefreshToken(user.id, metadata);

    await this.prisma.refreshToken.update({
      where: {
        id: refreshToken.id
      },
      data: {
        revokedAt: new Date(),
        replacedByTokenId: nextTokenId
      }
    });

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      tokenType: "Bearer",
      expiresIn: this.env.authAccessTokenTtlSeconds,
      refreshExpiresAt: nextRefreshExpiresAt.toISOString()
    };
  }

  async logout(rawRefreshToken: string) {
    const hashed = this.hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: {
        tokenHash: hashed
      }
    });

    if (existing && !existing.revokedAt) {
      await this.prisma.refreshToken.update({
        where: {
          id: existing.id
        },
        data: {
          revokedAt: new Date()
        }
      });
    }

    return {
      ok: true
    };
  }

  async exchangeGithubOAuthCode(
    input: {
      code: string;
      redirectUri: string;
    },
    metadata?: {
      userAgent?: string;
      ipAddress?: string;
    }
  ) {
    const githubClientId = this.env.githubClientId?.trim();
    const githubClientSecret = this.env.githubClientSecret?.trim();

    if (!githubClientId || !githubClientSecret) {
      throw new BadRequestException("GitHub OAuth is not configured");
    }

    const tokenExchangeResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "Branchline API"
      },
      body: JSON.stringify({
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code: input.code,
        redirect_uri: input.redirectUri
      })
    });

    if (!tokenExchangeResponse.ok) {
      throw new BadRequestException("GitHub OAuth token exchange failed");
    }

    const tokenPayload = (await tokenExchangeResponse.json()) as Record<string, unknown>;
    const githubAccessToken =
      typeof tokenPayload.access_token === "string" ? tokenPayload.access_token : undefined;

    if (!githubAccessToken) {
      const reason =
        typeof tokenPayload.error_description === "string"
          ? tokenPayload.error_description
          : typeof tokenPayload.error === "string"
            ? tokenPayload.error
            : "missing_access_token";
      throw new BadRequestException(`GitHub OAuth token exchange failed: ${reason}`);
    }

    return this.exchangeGithubAccessToken(
      {
        accessToken: githubAccessToken
      },
      metadata
    );
  }

  async exchangeGithubAccessToken(
    input: {
      accessToken: string;
    },
    metadata?: {
      userAgent?: string;
      ipAddress?: string;
    }
  ) {
    const githubHeaders = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.accessToken}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "Branchline API"
    };

    const profileResponse = await fetch("https://api.github.com/user", {
      headers: githubHeaders
    });

    if (!profileResponse.ok) {
      throw new BadRequestException("Failed to load GitHub profile");
    }

    const profilePayload = (await profileResponse.json()) as GithubProfile;
    const githubId = Number(profilePayload.id);
    if (!Number.isFinite(githubId)) {
      throw new BadRequestException("GitHub profile is missing id");
    }

    const githubLogin =
      typeof profilePayload.login === "string" && profilePayload.login.trim().length > 0
        ? profilePayload.login.trim()
        : `github_${githubId}`;

    const emailFromProfile =
      typeof profilePayload.email === "string" && profilePayload.email.includes("@")
        ? profilePayload.email.toLowerCase()
        : undefined;

    let email = emailFromProfile;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: githubHeaders
      });

      if (emailsResponse.ok) {
        const emailsPayload = (await emailsResponse.json()) as unknown;
        const entries = Array.isArray(emailsPayload) ? (emailsPayload as GithubEmailEntry[]) : [];
        const primaryVerified = entries.find(
          (entry) =>
            typeof entry.email === "string" &&
            entry.email.includes("@") &&
            entry.primary === true &&
            entry.verified === true
        );
        const verified = entries.find(
          (entry) =>
            typeof entry.email === "string" && entry.email.includes("@") && entry.verified === true
        );
        const any = entries.find(
          (entry) => typeof entry.email === "string" && entry.email.includes("@")
        );
        email = (primaryVerified?.email ?? verified?.email ?? any?.email)?.toLowerCase();
      }
    }

    if (!email) {
      email = `${githubLogin}@users.noreply.github.com`;
    }

    const displayName =
      typeof profilePayload.name === "string" && profilePayload.name.trim().length > 0
        ? profilePayload.name.trim()
        : githubLogin;

    const avatarUrl =
      typeof profilePayload.avatar_url === "string" && profilePayload.avatar_url.trim().length > 0
        ? profilePayload.avatar_url
        : undefined;

    const user = await this.upsertUserWithIdentity({
      clerkUserId: `github_${githubId}`,
      email,
      displayName,
      avatarUrl
    });

    const role = await this.resolveEffectiveRole(user.id, "member");
    const accessToken = await this.signAccessToken({
      sub: user.clerkUserId,
      email: user.email,
      role
    });
    const { rawToken: refreshToken, expiresAt } = await this.createRefreshToken(user.id, metadata);

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.env.authAccessTokenTtlSeconds,
      refreshExpiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? displayName,
        avatarUrl: user.avatarUrl ?? avatarUrl
      }
    };
  }

  async authenticateToken(token: string): Promise<AuthContext> {
    const claims = await this.verifyToken(token);

    const clerkUserId = String(claims.sub ?? "");
    if (!clerkUserId) {
      throw new UnauthorizedException("Token subject is missing");
    }

    const email = String(claims.email ?? `${clerkUserId}@branchline.dev`).toLowerCase();
    const roleFromToken = normalizeRole(claims.role);

    const user = await this.upsertUserWithIdentity({
      clerkUserId,
      email,
      displayName: String(claims.name ?? email.split("@")[0] ?? "Branchline User"),
      avatarUrl: claims.picture ? String(claims.picture) : undefined
    });

    const role = await this.resolveEffectiveRole(user.id, roleFromToken);

    return {
      userId: user.id,
      clerkUserId,
      email: user.email,
      role
    };
  }

  private async createRefreshToken(
    userId: string,
    metadata?: {
      userAgent?: string;
      ipAddress?: string;
    }
  ) {
    const rawToken = randomUUID();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.env.authRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

    const token = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress
      }
    });

    return {
      id: token.id,
      rawToken,
      expiresAt
    };
  }

  private async findValidRefreshToken(rawToken: string) {
    const hashed = this.hashToken(rawToken);

    const refreshToken = await this.prisma.refreshToken.findUnique({
      where: {
        tokenHash: hashed
      }
    });

    if (!refreshToken) {
      throw new UnauthorizedException("Unknown refresh token");
    }

    if (refreshToken.revokedAt) {
      throw new UnauthorizedException("Refresh token revoked");
    }

    if (refreshToken.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    return refreshToken;
  }

  private async resolveEffectiveRole(userId: string, fallbackRole: BranchlineRole): Promise<BranchlineRole> {
    let memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId,
        status: "active"
      },
      select: {
        role: true
      }
    });

    if (memberships.length === 0) {
      await this.ensureDefaultWorkspace(userId);
      memberships = await this.prisma.organizationMember.findMany({
        where: {
          userId,
          status: "active"
        },
        select: {
          role: true
        }
      });
      if (memberships.length === 0) {
        return fallbackRole;
      }
    }

    const strongest = memberships
      .map((membership) => normalizeRole(membership.role))
      .sort((left, right) => roleWeight(right) - roleWeight(left))[0];

    return strongest ?? fallbackRole;
  }

  private async ensureDefaultWorkspace(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        email: true,
        displayName: true
      }
    });

    if (!user) {
      return;
    }

    const activeMemberships = await this.prisma.organizationMember.count({
      where: {
        userId: user.id,
        status: "active"
      }
    });

    if (activeMemberships > 0) {
      return;
    }

    const emailLocalPart = user.email.split("@")[0]?.trim() || "branchline";
    const displayLabel = user.displayName?.trim() || emailLocalPart;
    const orgSlug = `workspace-${user.id.replace(/-/g, "").slice(0, 12)}`;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const existingMemberships = await tx.organizationMember.count({
        where: {
          userId: user.id,
          status: "active"
        }
      });

      if (existingMemberships > 0) {
        return;
      }

      const organization = await tx.organization.upsert({
        where: {
          slug: orgSlug
        },
        update: {
          ownerUserId: user.id
        },
        create: {
          name: `${displayLabel} Workspace`,
          slug: orgSlug,
          ownerUserId: user.id,
          settings: {}
        }
      });

      await tx.organizationMember.upsert({
        where: {
          orgId_userId: {
            orgId: organization.id,
            userId: user.id
          }
        },
        update: {
          role: "owner",
          status: "active",
          joinedAt: now
        },
        create: {
          orgId: organization.id,
          userId: user.id,
          role: "owner",
          status: "active",
          joinedAt: now
        }
      });

      const project = await tx.project.upsert({
        where: {
          orgId_key: {
            orgId: organization.id,
            key: "HOME"
          }
        },
        update: {
          name: "Getting Started",
          defaultBaseBranch: "main"
        },
        create: {
          orgId: organization.id,
          name: "Getting Started",
          key: "HOME",
          defaultBaseBranch: "main",
          settings: {},
          createdBy: user.id
        }
      });

      await tx.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: project.id,
            userId: user.id
          }
        },
        update: {
          role: "admin",
          status: "active"
        },
        create: {
          projectId: project.id,
          userId: user.id,
          role: "admin",
          status: "active"
        }
      });
    });
  }

  private async signAccessToken(input: { sub: string; email: string; role: BranchlineRole }): Promise<string> {
    const key = createSecretKey(Buffer.from(this.env.authJwtSecret));

    return new SignJWT({
      email: input.email,
      role: input.role
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.sub)
      .setIssuer(this.devIssuer)
      .setAudience("branchline-api")
      .setIssuedAt()
      .setExpirationTime(`${this.env.authAccessTokenTtlSeconds}s`)
      .sign(key);
  }

  private async verifyToken(token: string): Promise<Record<string, unknown>> {
    if (this.env.clerkJwksUrl && this.env.clerkIssuer) {
      try {
        const jwks = createRemoteJWKSet(new URL(this.env.clerkJwksUrl));
        const { payload } = await jwtVerify(token, jwks, {
          issuer: this.env.clerkIssuer
        });
        return payload as Record<string, unknown>;
      } catch {
        // Allow first-party JWT fallback for local GitHub OAuth sessions.
      }
    }

    const key = createSecretKey(Buffer.from(this.env.authJwtSecret));
    const { payload } = await jwtVerify(token, key, {
      issuer: this.devIssuer,
      audience: "branchline-api"
    });

    return payload as Record<string, unknown>;
  }

  private hashToken(value: string): string {
    return createHash("sha256")
      .update(`${value}:${this.env.authJwtSecret}`)
      .digest("hex");
  }

  private async upsertUserWithIdentity(input: {
    clerkUserId: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
  }) {
    const existingByClerk = await this.prisma.user.findUnique({
      where: {
        clerkUserId: input.clerkUserId
      }
    });

    if (existingByClerk) {
      return this.prisma.user.update({
        where: {
          id: existingByClerk.id
        },
        data: {
          email: input.email,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          lastLoginAt: new Date()
        }
      });
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: {
        email: input.email
      }
    });

    if (existingByEmail) {
      return this.prisma.user.update({
        where: {
          id: existingByEmail.id
        },
        data: {
          clerkUserId: input.clerkUserId,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          lastLoginAt: new Date()
        }
      });
    }

    return this.prisma.user.create({
      data: {
        clerkUserId: input.clerkUserId,
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        lastLoginAt: new Date()
      }
    });
  }
}
