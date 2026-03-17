import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module.js";
import { ActivityController } from "./activity.controller.js";

@Module({
  imports: [RealtimeModule],
  controllers: [ActivityController]
})
export class ActivityModule {}
