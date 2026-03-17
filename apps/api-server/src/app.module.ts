import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { APP_GUARD } from "@nestjs/core";

import { readEnv } from "./common/env.js";
import { PrismaModule } from "./common/prisma.module.js";
import { ActivityModule } from "./modules/activity/activity.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthGuard } from "./modules/auth/auth.guard.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { RolesGuard } from "./modules/auth/roles.guard.js";
import { BranchesModule } from "./modules/branches/branches.module.js";
import { ConflictsModule } from "./modules/conflicts/conflicts.module.js";
import { GithubAppModule } from "./modules/github-app/github-app.module.js";
import { GuardrailsModule } from "./modules/guardrails/guardrails.module.js";
import { HandoffsModule } from "./modules/handoffs/handoffs.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { IntentModule } from "./modules/intent/intent.module.js";
import { MembershipsModule } from "./modules/memberships/memberships.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { ObservabilityModule } from "./modules/observability/observability.module.js";
import { OrganizationsModule } from "./modules/organizations/organizations.module.js";
import { PivotModule } from "./modules/pivot/pivot.module.js";
import { ProjectKnowledgeModule } from "./modules/project-knowledge/project-knowledge.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { PromptLibraryModule } from "./modules/prompt-library/prompt-library.module.js";
import { ProvenanceModule } from "./modules/provenance/provenance.module.js";
import { QualityGatesModule } from "./modules/quality-gates/quality-gates.module.js";
import { RealtimeModule } from "./modules/realtime/realtime.module.js";
import { ReplayModule } from "./modules/replay/replay.module.js";
import { RepositoriesModule } from "./modules/repositories/repositories.module.js";
import { TasksModule } from "./modules/tasks/tasks.module.js";
import { WorkspaceBindingsModule } from "./modules/workspace-bindings/workspace-bindings.module.js";

const env = readEnv();

@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({
      connection: {
        url: env.redisUrl
      }
    }),
    BullModule.registerQueue(
      { name: "queue.intent.normalize" },
      { name: "queue.conflict.score" },
      { name: "queue.guardrail.evaluate" },
      { name: "queue.quality.run" },
      { name: "queue.pr.slice" },
      { name: "queue.handoff.generate" },
      { name: "queue.notifications.dispatch" },
      { name: "queue.analytics.rollup" },
      { name: "queue.dead_letter" }
    ),
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    ProjectKnowledgeModule,
    MembershipsModule,
    RepositoriesModule,
    GithubAppModule,
    TasksModule,
    BranchesModule,
    IntentModule,
    ActivityModule,
    ConflictsModule,
    GuardrailsModule,
    QualityGatesModule,
    PromptLibraryModule,
    ProvenanceModule,
    HandoffsModule,
    ReplayModule,
    PivotModule,
    IntegrationsModule,
    NotificationsModule,
    ObservabilityModule,
    AuditModule,
    RealtimeModule,
    WorkspaceBindingsModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard
    }
  ]
})
export class AppModule {}
