# Branchline – Ruthless Next Steps Plan

## Short Intro (Brutal Truth)

You are doing something most engineers do when they get excited:
you are building the **entire system before proving the core value**.

Right now:
- You have architecture
- You have modules
- You have infra
- You have CI

But you **do NOT have users**.

This is the mistake:
> You are optimizing for completeness instead of usefulness.

Why this is dangerous:
- You can spend months building
- No one uses it
- You don’t know what actually matters

So we are changing direction to:

> Build ONE feature that developers cannot live without.

That feature is:
## **AI Intent Timeline (Your Wedge)**

---

# Phase 0: Immediate Fixes (Day 0–2)

## 1. Fix Developer Onboarding (Blocking Issue)

### Problem
Your repo cannot be run easily.

### Action
Create `.env.example`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/branchline
REDIS_URL=redis://localhost:6379
AUTH_JWT_SECRET=dev-secret
BRANCHLINE_SMOKE_BEARER_TOKEN=dev-token
```

### Goal
A developer should be able to:

```
pnpm install
docker compose up -d
pnpm dev
```

WITHOUT friction.

---

## 2. Declare the Wedge (Non-Negotiable)

Add this to README:

> v0.1 focuses ONLY on Intent Timeline.
> All other features are disabled.

---

# Phase 1: Build the Core Wedge (Day 3–7)

## Feature: AI Intent Timeline

### What it does

When a developer uses AI:
- capture prompt
- capture AI output summary
- capture files changed
- capture final commit

### Output UI

```
Commit: add auth middleware

Prompt:
"Create JWT middleware"

AI Output:
Added middleware, token validation

Human Changes:
Modified expiry logic
```

---

## Step 1: Extension Changes

Keep ONLY:

- login
- bindWorkspace
- startAiTask
- viewTimeline

REMOVE:
- conflict system
- guardrails UI
- handoff
- replay
- integrations

---

## Step 2: Minimal Backend

Endpoint:

```
POST /intent
```

Payload:

```
{
  prompt: string,
  summary: string,
  files: string[],
  commitId: string
}
```

Store in:
- memory (initial)
- or simple DB table

---

## Step 3: Timeline UI

Requirements:
- show last 5 events
- instant load
- no filters
- no complexity

---

# Phase 2: Make It Useful (Day 7–14)

## 1. Redaction (CRITICAL)

Before sending prompt:
- remove API keys
- remove secrets
- remove emails

Default:
- partial capture only

---

## 2. Speed > Features

Timeline must:
- load < 200ms
- work offline fallback
- not block dev workflow

---

## 3. Demo Script

Create `DEMO.md`:

Steps:
1. Start extension
2. Run AI task
3. Commit code
4. View timeline

Must take < 5 minutes.

---

# Phase 3: Get Real Users (Week 2)

## Goal: 5 Teams

Find:
- startup devs
- friends
- freelancers

Ask them to use it live.

---

## Questions to Ask

1. Did this save time?
2. Would you keep using this?
3. Would you pay $5/month?

---

## Success Condition

If 3/5 say YES → continue

If not → pivot

---

# Phase 4: Metrics (Week 3)

Track ONLY ONE metric:

## Time to Understand Code Change

If timeline reduces confusion:
→ you win

---

# Phase 5: Expansion (ONLY AFTER VALIDATION)

Do NOT build before this.

Then add:

1. Team timeline
2. PR summary
3. Conflict warnings
4. Guardrails

---

# What You Must NOT Do

- Do NOT add more features
- Do NOT improve architecture
- Do NOT scale infra
- Do NOT build integrations

Until users exist.

---

# Final Reminder

You are not building a system.

You are building:
> something developers refuse to turn off

If they can ignore your tool:
→ you failed

If they depend on it:
→ you win
