# Intent Timeline v0.1 Product + Technical Spec

Version: 1.1
Date: 2026-03-17
Audience: Product, API, Web, Extension, QA
Status: Active implementation spec

## Product Goal

Developers should understand an AI-assisted code change quickly from one timeline surface, without context switching across tools.

## v0.1 Wedge Scope

1. extension login
2. workspace bind
3. start AI task
4. capture intent event
5. view latest timeline entries in extension and web

## API Contract (Locked)

### `POST /v1/intent`

Request:

```json
{
  "taskId": "uuid",
  "prompt": "string",
  "summary": "string",
  "files": ["string"],
  "commitId": "string"
}
```

Rules:

1. `taskId` must be valid and resolvable.
2. `prompt` and `summary` must be non-empty.
3. `files` is bounded and deduplicated.
4. `commitId` must be non-empty (`uncommitted` allowed in extension fallback path).
5. org/project scope is derived from `taskId`.
6. event is persisted to Postgres `IntentEvent`.
7. event is enqueued to `queue.intent.normalize`.

Response:

```json
{
  "accepted": true,
  "taskId": "uuid",
  "eventId": "uuid",
  "eventSeq": 1,
  "redactionLevel": "none|partial"
}
```

### `GET /v1/intent?taskId=<uuid>&limit=5`

Response:

```json
{
  "taskId": "uuid",
  "events": [
    {
      "eventId": "uuid",
      "eventSeq": 1,
      "timestamp": "ISO-8601",
      "prompt": "string",
      "summary": "string",
      "files": ["string"],
      "commitId": "string",
      "redactionLevel": "none|partial"
    }
  ]
}
```

Rules:

1. returns task-scoped events only.
2. latest events returned first.
3. default limit is 5 (max bounded server-side).
4. stable response shape for both extension and web clients.

## Redaction Contract

Always-on baseline patterns redact sensitive content before persistence:

1. email addresses
2. API key-like strings
3. common secret/token patterns

Org policy patterns are additive.

## Extension Contract

Only four commands are in runtime scope:

1. `branchline.login`
2. `branchline.bindWorkspace`
3. `branchline.startAiTask`
4. `branchline.viewTimeline`

Behavior requirements:

1. `startAiTask` captures prompt + summary + files + latest commit and calls `POST /v1/intent`.
2. failed captures are queued in workspace state.
3. queue flush runs before timeline read and before new capture attempts.

## Web Contract

Primary read surface is `/timeline`.

Behavior:

1. user selects a task from current project scope.
2. page fetches last 5 events via `GET /v1/intent`.
3. each card renders commit, prompt snippet, AI summary, files, and redaction level.

## Non-Goals For v0.1

1. project-wide aggregate timeline
2. drag-and-drop diagram editors
3. policy/quality/integration expansion
4. non-wedge collaboration panels

## Acceptance Criteria

1. wedge loop (`login -> bindWorkspace -> startAiTask -> viewTimeline`) runs in under 5 minutes.
2. web and extension show the same task-scoped timeline contract.
3. redaction tests pass for baseline patterns.
4. non-wedge runtime surfaces remain removed from active paths.
