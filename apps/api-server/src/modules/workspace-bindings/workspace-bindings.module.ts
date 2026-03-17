import { Module } from "@nestjs/common";

import { WorkspaceBindingsController } from "./workspace-bindings.controller.js";

@Module({
  controllers: [WorkspaceBindingsController]
})
export class WorkspaceBindingsModule {}
