import { Module } from "@nestjs/common";

import { ProjectKnowledgeController } from "./project-knowledge.controller.js";

@Module({
  controllers: [ProjectKnowledgeController]
})
export class ProjectKnowledgeModule {}
