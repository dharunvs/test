#!/usr/bin/env node

import { argv, env, exit } from "node:process";
import { performance } from "node:perf_hooks";

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  if (!value) {
    return fallback;
  }
  return value.slice(prefix.length);
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const taskId = parseArg("taskId", "").trim();
const limit = Number.parseInt(parseArg("limit", "5"), 10);
const iterations = Number.parseInt(parseArg("iterations", "50"), 10);
const thresholdMs = Number.parseFloat(parseArg("thresholdMs", "200"));

if (!taskId) {
  console.error("Missing required --taskId=<uuid>");
  exit(1);
}

if (!Number.isFinite(limit) || limit <= 0) {
  console.error("--limit must be a positive integer");
  exit(1);
}

if (!Number.isFinite(iterations) || iterations <= 0) {
  console.error("--iterations must be a positive integer");
  exit(1);
}

const baseUrl = (env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/$/, "");
const token = env.BRANCHLINE_E2E_BEARER_TOKEN ?? env.BRANCHLINE_SMOKE_BEARER_TOKEN;

if (!token) {
  console.error("Missing BRANCHLINE_E2E_BEARER_TOKEN or BRANCHLINE_SMOKE_BEARER_TOKEN");
  exit(1);
}

const endpoint = `${baseUrl}/intent?taskId=${encodeURIComponent(taskId)}&limit=${limit}`;
const timings = [];

for (let i = 0; i < iterations; i += 1) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  const elapsed = performance.now() - started;

  if (!response.ok) {
    console.error(`Request failed at iteration ${i + 1}: ${response.status} ${response.statusText}`);
    exit(1);
  }

  await response.json();
  timings.push(elapsed);
}

const p50 = percentile(timings, 50);
const p95 = percentile(timings, 95);
const min = Math.min(...timings);
const max = Math.max(...timings);

console.log("Intent read benchmark complete");
console.log(`Endpoint: ${endpoint}`);
console.log(`Iterations: ${iterations}`);
console.log(`min: ${min.toFixed(2)}ms`);
console.log(`p50: ${p50.toFixed(2)}ms`);
console.log(`p95: ${p95.toFixed(2)}ms`);
console.log(`max: ${max.toFixed(2)}ms`);
console.log(`Threshold: ${thresholdMs.toFixed(2)}ms`);

if (p95 > thresholdMs) {
  console.error(`FAIL: p95 ${p95.toFixed(2)}ms exceeds threshold ${thresholdMs.toFixed(2)}ms`);
  exit(1);
}

console.log(`PASS: p95 ${p95.toFixed(2)}ms is within threshold`);
