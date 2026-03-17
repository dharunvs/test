import { Module } from "@nestjs/common";

import { PromptLibraryController } from "./prompt-library.controller.js";

@Module({
  controllers: [PromptLibraryController]
})
export class PromptLibraryModule {}
