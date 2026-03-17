import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthContext } from "./auth.types.js";
import { AuthService } from "./auth.service.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      auth?: AuthContext;
    }>();

    const authorization = request.headers.authorization;
    if (!authorization || Array.isArray(authorization)) {
      throw new UnauthorizedException("Missing bearer token");
    }

    if (!authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException("Invalid authorization scheme");
    }

    const token = authorization.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException("Bearer token is empty");
    }

    request.auth = await this.authService.authenticateToken(token);
    return true;
  }
}
