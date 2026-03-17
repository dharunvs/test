import { Module } from "@nestjs/common";

import { ReplayController } from "./replay.controller.js";

@Module({
  controllers: [ReplayController]
})
export class ReplayModule {}
