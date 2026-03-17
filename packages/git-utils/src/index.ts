export interface BranchNameInput {
  ticketOrTask: string;
  taskSlug: string;
  timestamp?: Date;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function toUtcCompactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildTaskBranchName(input: BranchNameInput): string {
  const ts = toUtcCompactTimestamp(input.timestamp ?? new Date());
  return `ai/${slugify(input.ticketOrTask)}/${slugify(input.taskSlug)}-${ts}`;
}

export function isProtectedBranch(branch: string, protectedBranches: string[]): boolean {
  return protectedBranches.includes(branch);
}

export function buildMetadataTrailers(runId: string, taskId: string, intentId: string): string[] {
  return [
    `X-Collab-Run-Id: ${runId}`,
    `X-Collab-Task-Id: ${taskId}`,
    `X-Collab-Intent-Id: ${intentId}`
  ];
}
