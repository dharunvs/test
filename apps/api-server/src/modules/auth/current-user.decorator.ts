import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import type { AuthContext } from "./auth.types.js";

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<{ auth?: AuthContext }>();
  if (!request.auth) {
    throw new Error("Auth context is missing from request");
  }
  return request.auth;
});
