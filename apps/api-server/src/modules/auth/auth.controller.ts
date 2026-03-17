import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "./current-user.decorator.js";
import { Public } from "./public.decorator.js";
import { AuthService } from "./auth.service.js";
import type { AuthContext } from "./auth.types.js";

const startDeviceSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(["owner", "admin", "member", "viewer"]).optional()
});

const deviceCodeSchema = z.object({
  deviceCode: z.string().uuid()
});

const approveSchema = z.object({
  userCode: z.string().min(6)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10)
});

const logoutSchema = z.object({
  refreshToken: z.string().min(10)
});

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("device/start")
  startDevice(@Body() body: unknown) {
    const input = startDeviceSchema.parse(body);
    return this.authService.startDeviceFlow(input);
  }

  @Public()
  @Post("device/approve")
  approveDevice(@Body() body: unknown) {
    const input = approveSchema.parse(body);
    return this.authService.approveDeviceCode(input.userCode);
  }

  @Public()
  @Post("device/token")
  exchangeDeviceToken(
    @Body() body: unknown,
    @Headers("user-agent") userAgent?: string,
    @Headers("x-forwarded-for") ipAddress?: string
  ) {
    const input = deviceCodeSchema.parse(body);
    return this.authService.exchangeDeviceCode(input.deviceCode, {
      userAgent,
      ipAddress
    });
  }

  @Public()
  @Post("refresh")
  refresh(
    @Body() body: unknown,
    @Headers("user-agent") userAgent?: string,
    @Headers("x-forwarded-for") ipAddress?: string
  ) {
    const input = refreshSchema.parse(body);
    return this.authService.refreshAccessToken(input.refreshToken, {
      userAgent,
      ipAddress
    });
  }

  @Public()
  @Post("logout")
  logout(@Body() body: unknown) {
    const input = logoutSchema.parse(body);
    return this.authService.logout(input.refreshToken);
  }

  @Get("me")
  getMe(@CurrentUser() user: AuthContext) {
    return user;
  }
}
