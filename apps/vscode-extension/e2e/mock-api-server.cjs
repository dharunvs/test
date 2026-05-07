const http = require("node:http");
const { randomUUID } = require("node:crypto");

const IDS = {
  ORG_ID: "11111111-1111-1111-1111-111111111111",
  PROJECT_ID: "22222222-2222-2222-2222-222222222222",
  REPO_MAIN_ID: "33333333-3333-3333-3333-333333333333",
  REPO_MISMATCH_ID: "44444444-4444-4444-4444-444444444444"
};

function toJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json"
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function startMockApiServer() {
  const state = {
    auth: {
      refreshCalls: 0
    },
    workspace: {
      validateCalls: 0,
      bindCalls: 0
    },
    task: {
      created: 0,
      protectedBranchBlocks: 0,
      branchesCreated: 0,
      intentCaptures: 0,
      timelineReads: 0,
      latestTaskTitle: null
    },
    presenceUpdates: 0,
    tasksById: {},
    intentsByTaskId: {}
  };

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const { pathname } = url;

      if (method === "GET" && pathname === "/__state") {
        toJson(res, 200, {
          ...state,
          ids: IDS
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/auth/device/start") {
        toJson(res, 200, {
          deviceCode: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          userCode: "ABC-123",
          verificationUri: "http://localhost:3000/device",
          verificationUriComplete: "http://localhost:3000/device?user_code=ABC-123",
          verificationRequired: false,
          expiresIn: 60,
          interval: 1
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/auth/github/token") {
        toJson(res, 200, {
          accessToken: "access-token-github",
          refreshToken: "refresh-token-github",
          tokenType: "Bearer",
          expiresIn: 1,
          refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString()
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/auth/device/token") {
        toJson(res, 200, {
          status: "approved",
          accessToken: "access-token-initial",
          refreshToken: "refresh-token-initial",
          tokenType: "Bearer",
          expiresIn: 1,
          refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString()
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/auth/refresh") {
        state.auth.refreshCalls += 1;
        toJson(res, 200, {
          accessToken: `access-token-refresh-${state.auth.refreshCalls}`,
          refreshToken: `refresh-token-refresh-${state.auth.refreshCalls}`,
          tokenType: "Bearer",
          expiresIn: 3600,
          refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString()
        });
        return;
      }

      if (method === "GET" && pathname === "/v1/orgs") {
        toJson(res, 200, [
          {
            id: IDS.ORG_ID,
            name: "Branchline Extension E2E",
            slug: "branchline-extension-e2e",
            role: "owner"
          }
        ]);
        return;
      }

      const projectsMatch = pathname.match(/^\/v1\/projects\/([^/]+)$/);
      if (method === "GET" && projectsMatch) {
        if (projectsMatch[1] !== IDS.ORG_ID) {
          toJson(res, 200, []);
          return;
        }
        toJson(res, 200, [
          {
            id: IDS.PROJECT_ID,
            orgId: IDS.ORG_ID,
            name: "Extension MVP",
            key: "EXT",
            defaultBaseBranch: "main"
          }
        ]);
        return;
      }

      if (method === "GET" && pathname === "/v1/repositories") {
        const projectId = url.searchParams.get("projectId");
        if (projectId !== IDS.PROJECT_ID) {
          toJson(res, 200, []);
          return;
        }
        toJson(res, 200, [
          {
            id: IDS.REPO_MAIN_ID,
            provider: "github",
            fullName: "branchline/extension-e2e",
            defaultBranch: "main",
            isPrivate: true
          },
          {
            id: IDS.REPO_MISMATCH_ID,
            provider: "github",
            fullName: "branchline/mismatch-e2e",
            defaultBranch: "main",
            isPrivate: true
          }
        ]);
        return;
      }

      if (method === "POST" && pathname === "/v1/workspaces/validate") {
        state.workspace.validateCalls += 1;
        const body = await parseBody(req);
        const repositoryId = String(body.repositoryId ?? "");
        toJson(res, 200, {
          valid: repositoryId !== IDS.REPO_MISMATCH_ID
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/workspaces/bind") {
        state.workspace.bindCalls += 1;
        const body = await parseBody(req);
        toJson(res, 200, {
          id: randomUUID(),
          orgId: body.orgId,
          projectId: body.projectId,
          repositoryId: body.repositoryId,
          workspaceHash: body.workspaceHash,
          lastBoundAt: new Date().toISOString()
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/tasks/start") {
        const body = await parseBody(req);
        const taskId = randomUUID();
        state.task.created += 1;
        state.task.latestTaskTitle = String(body.title ?? "");
        state.tasksById[taskId] = {
          id: taskId,
          title: state.task.latestTaskTitle
        };

        toJson(res, 200, {
          id: taskId,
          title: state.task.latestTaskTitle
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/branches/create") {
        const body = await parseBody(req);
        const currentBranch = String(body.currentBranch ?? "");
        const policy = {
          baseBranch: "main",
          protectedBranches: ["main", "release"],
          autoPush: true,
          autoPr: false,
          staleThresholdMinutes: 120,
          cleanupAfterMergeHours: 24
        };

        if (currentBranch === "main") {
          state.task.protectedBranchBlocks += 1;
          toJson(res, 200, {
            blocked: true,
            reason: "Protected branch branchline policy blocked direct AI branch flow on main",
            policy,
            pullRequest: null
          });
          return;
        }

        state.task.branchesCreated += 1;
        const sanitizedSlug = String(body.taskSlug ?? "task")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 40) || "task";
        const branchName = `branchline/${sanitizedSlug}-${state.task.branchesCreated}`;
        toJson(res, 200, {
          blocked: false,
          policy,
          branch: {
            id: randomUUID(),
            name: branchName,
            baseBranch: "main"
          },
          pullRequest: null
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/intent") {
        state.task.intentCaptures += 1;
        const body = await parseBody(req);
        const taskId = String(body.taskId ?? "");
        const existing = state.intentsByTaskId[taskId] ?? [];
        const event = {
          eventId: randomUUID(),
          eventSeq: existing.length + 1,
          timestamp: new Date().toISOString(),
          prompt: String(body.prompt ?? ""),
          summary: String(body.summary ?? ""),
          files: Array.isArray(body.files) ? body.files : [],
          commitId: String(body.commitId ?? ""),
          redactionLevel: "none"
        };
        state.intentsByTaskId[taskId] = [event, ...existing].slice(0, 20);
        toJson(res, 200, {
          accepted: true,
          taskId,
          eventId: event.eventId,
          eventSeq: event.eventSeq,
          redactionLevel: "none"
        });
        return;
      }

      if (method === "GET" && pathname === "/v1/intent") {
        state.task.timelineReads += 1;
        const taskId = String(url.searchParams.get("taskId") ?? "");
        const limit = Number(url.searchParams.get("limit") ?? 5);
        const events = (state.intentsByTaskId[taskId] ?? []).slice(0, Number.isFinite(limit) ? limit : 5);
        toJson(res, 200, {
          taskId,
          events
        });
        return;
      }

      if (method === "POST" && pathname === "/v1/activity/presence") {
        state.presenceUpdates += 1;
        toJson(res, 200, {
          ok: true,
          presence: {
            id: randomUUID()
          }
        });
        return;
      }

      toJson(res, 404, {
        message: `mock endpoint not found: ${method} ${pathname}`
      });
    } catch (error) {
      toJson(res, 500, {
        message: error instanceof Error ? error.message : "mock server error"
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind mock API server"));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        stop: () =>
          new Promise((innerResolve) => {
            server.close(() => innerResolve(undefined));
          })
      });
    });
  });
}

module.exports = {
  IDS,
  startMockApiServer
};
