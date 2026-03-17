import { Module } from "@nestjs/common";

import { MembershipsController } from "./memberships.controller.js";

@Module({
  controllers: [MembershipsController]
})
export class MembershipsModule {}
