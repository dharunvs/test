import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { BranchesService } from "./branches.service.js";

const createBranchSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  ticketOrTask: z.string().min(1),
  taskSlug: z.string().min(1),
  currentBranch: z.string().min(1)
});

@Controller("branches")
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Roles("owner", "admin", "member")
  @Post("create")
  async create(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = createBranchSchema.parse(body);
    return this.branchesService.createBranch({
      ...input,
      actorUserId: user.userId
    });
  }
}

