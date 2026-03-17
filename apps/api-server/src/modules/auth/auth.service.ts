import { createHash, createSecretKey, randomUUID } from "node:crypto";

import { Injectable, UnauthorizedException } from "@nestjs/common";
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

@Injectable()
export class AuthService {
  private readonly env = readEnv();
  private readonly devIssuer = "branchline-dev";

  constructor(private readonly prisma: PrismaService) {}

  async startDeviceFlow(input?: { email?: string; role?: BranchlineRole }) {
    const email = (input?.email ?? "demo@branchline.dev").toLowerCase().trim();
    const role = normalizeRole(input?.role);
    const clerkUserId = `dev_${email.replace(/[^a-z0-9]/g, "_")}`;

    const deviceCode = randomUUID();
    const userCode = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + this.env.authDeviceCodeTtlSeconds * 1000);

    await this.prisma.deviceAuthSession.create({
      data: {
        deviceCode,
        userCode,
        email,
        role,
        clerkUserId,
        status: this.env.nodeEnv === "production" ? "pending" : "approved",
        approvedAt: this.env.nodeEnv === "production" ? null : new Date(),
        expiresAt
      }
    });

    return {
      deviceCode,
      userCode,
      verificationUri: "https://branchline.dev/device",
      verificationUriComplete: `https://branchline.dev/device?user_code=${userCode}`,
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
    const memberships = await this.prisma.organizationMember.findMany({
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

    const strongest = memberships
      .map((membership) => normalizeRole(membership.role))
      .sort((left, right) => roleWeight(right) - roleWeight(left))[0];

    return strongest ?? fallbackRole;
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
      const jwks = createRemoteJWKSet(new URL(this.env.clerkJwksUrl));
      const { payload } = await jwtVerify(token, jwks, {
        issuer: this.env.clerkIssuer
      });
      return payload as Record<string, unknown>;
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
