import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module.js";
import { BranchesController } from "./branches.controller.js";
import { BranchesService } from "./branches.service.js";

@Module({
  imports: [RealtimeModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService]
})
export class BranchesModule {}
